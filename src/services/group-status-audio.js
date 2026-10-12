'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const BRANDING = Object.freeze({
  title: 'MUGIWARA NO PLAG',
  subtitle: 'DEVELOPER DE KAIDO MD',
  tags: 'KAIDO MD  •  STATUT AUDIO DE GROUPE'
});

const DESIGN = Object.freeze({
  width: 720,
  height: 1280,
  fps: 25,
  background: '0x0B0D19',
  panel: '0x15182A',
  track: '0x282B42',
  gold: '0xFFD166',
  cyan: '0x58E1E8',
  violet: '0xA879FF',
  muted: '0xB8C0D9'
});

const FONT_CANDIDATES = Object.freeze([
  path.join(__dirname, '../../assets/fonts/Poppins-SemiBold.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'
]);

let ffmpegCache = null;
const MAX_AUDIO_INPUT_BYTES = positiveInteger(process.env.AUDIO_STATUS_MAX_INPUT_BYTES, 32 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024);
const MAX_AUDIO_OUTPUT_BYTES = positiveInteger(process.env.AUDIO_STATUS_MAX_OUTPUT_BYTES, 64 * 1024 * 1024, 1024 * 1024, 512 * 1024 * 1024);
const MAX_AUDIO_CONCURRENT_JOBS = positiveInteger(process.env.AUDIO_STATUS_MAX_CONCURRENT, 1, 1, 4);
const MAX_AUDIO_QUEUED_JOBS = positiveInteger(process.env.AUDIO_STATUS_MAX_QUEUE, 2, 0, 16);

function positiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createAudioJobQueue({
  maxConcurrent = 1,
  maxQueued = 0,
  busyMessage = 'Les conversions audio sont occupées. Réessaie dans un instant.'
} = {}) {
  const concurrency = positiveInteger(maxConcurrent, 1, 1, 4);
  const queueLimit = positiveInteger(maxQueued, 0, 0, 16);
  const waiting = [];
  let active = 0;

  function drain() {
    while (active < concurrency && waiting.length) {
      const job = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active = Math.max(0, active - 1);
          drain();
        });
    }
  }

  function run(task) {
    return new Promise((resolve, reject) => {
      if (active >= concurrency && waiting.length >= queueLimit) {
        reject(new Error(busyMessage));
        return;
      }
      waiting.push({ task, resolve, reject });
      drain();
    });
  }

  function stats() {
    return { active, waiting: waiting.length, maxConcurrent: concurrency, maxQueued: queueLimit };
  }

  return { run, stats };
}

const audioStatusQueue = createAudioJobQueue({
  maxConcurrent: MAX_AUDIO_CONCURRENT_JOBS,
  maxQueued: MAX_AUDIO_QUEUED_JOBS
});

function runAudioStatusJob(task) {
  return audioStatusQueue.run(task);
}

function getAudioStatusQueueStats() {
  return audioStatusQueue.stats();
}

function escapeFilterPath(filePath) {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/'/g, "\\'");
}

function safeDuration(probedSeconds, fallbackSeconds) {
  const candidate = Number(probedSeconds) || Number(fallbackSeconds) || 60;
  return Number.isFinite(candidate) ? Math.max(1, candidate) : 60;
}

function formatTime(seconds) {
  const numeric = Number(seconds);
  const value = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(remainder).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function findFont() {
  return FONT_CANDIDATES.find(candidate => fs.existsSync(candidate)) || null;
}

async function resolveFfmpeg() {
  if (ffmpegCache) return ffmpegCache;
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const bundled = require('ffmpeg-static');
    if (bundled) candidates.push(bundled);
  } catch {
    // L’installation peut choisir de fournir ffmpeg système uniquement.
  }
  candidates.push('ffmpeg');

  for (const binary of [...new Set(candidates)]) {
    try {
      const { stdout, stderr } = await execFileAsync(
        binary,
        ['-hide_banner', '-filters'],
        { maxBuffer: 4 * 1024 * 1024, timeout: 15000 }
      );
      if (/\bdrawtext\b/.test(`${stdout || ''}\n${stderr || ''}`)) {
        ffmpegCache = binary;
        return binary;
      }
    } catch {
      // Essayer le binaire suivant; ffmpeg-static est parfois compilé sans drawtext.
    }
  }

  throw new Error(
    'FFmpeg avec le filtre drawtext introuvable. Installe ffmpeg avec libfreetype, ' +
    'ou configure FFMPEG_PATH.'
  );
}

function getAudioDuration(ffmpegPath, inputPath) {
  return new Promise(resolve => {
    execFile(
      ffmpegPath,
      ['-hide_banner', '-i', inputPath],
      { timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
      (_error, _stdout, stderr) => {
        const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr || '');
        resolve(match
          ? (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3])
          : 0);
      }
    );
  });
}

function createTextFilter(fontPath, textPath, size, color, x, y, extra = '') {
  return `drawtext=fontfile=${escapeFilterPath(fontPath)}`
    + `:textfile=${escapeFilterPath(textPath)}:fontsize=${size}:fontcolor=${color}`
    + `:x=${x}:y=${y}:shadowcolor=black@0.65:shadowx=2:shadowy=2`
    + `${extra ? `:${extra}` : ''}`;
}

/** Construit le filtre animé à part pour que le rendu puisse être vérifié sans ffmpeg. */
function buildAudioStatusFilterGraph({ fontPath, textPaths, durationSeconds, design: designOverrides = {} }) {
  const design = { ...DESIGN, ...(designOverrides || {}) };
  const duration = safeDuration(durationSeconds, 1).toFixed(2);
  const titleX = '(w-text_w)/2-560*exp(-3.5*t)+12*sin(2*PI*t/4)*(1-exp(-3*t))';
  const subtitleY = '270+55*exp(-4*t)';
  const subtitleFade = "alpha='min(1,max(0,(t-0.35)/0.85))'";
  const tagsPulse = "alpha='0.78+0.22*sin(2*PI*t/2.8)'";

  // Le fond, le bandeau et le panneau forment une carte sombre avec des accents
  // violet/cyan. Les textes sont externalisés en fichiers pour conserver accents
  // et apostrophes sans échapper du filtergraph.
  if (!textPaths || ['title', 'subtitle', 'tags', 'current', 'total'].some(key => !textPaths[key])) {
    throw new Error('Les fichiers de texte du statut audio sont incomplets.');
  }
  const textFiles = textPaths;

  const dt = (key, size, color, x, y, extra = '') =>
    createTextFilter(fontPath, textFiles[key], size, color, x, y, extra);

  return [
    `color=c=${design.background}:s=${design.width}x${design.height}:r=${design.fps},`
      + `drawbox=x=0:y=0:w=${design.width}:h=9:color=${design.violet}:t=fill,`
      + `drawbox=x=0:y=${design.height - 9}:w=${design.width}:h=9:color=${design.cyan}:t=fill,`
      + `drawbox=x=30:y=480:w=660:h=455:color=${design.panel}:t=fill,`
      + `drawbox=x=30:y=480:w=660:h=4:color=${design.violet}:t=fill,`
      + `drawbox=x=30:y=931:w=660:h=4:color=${design.cyan}:t=fill[bg]`,
    `[0:a:0]showwaves=s=640x300:mode=cline:rate=${design.fps}:colors=${design.cyan},`
      + 'format=rgba,colorkey=0x000000:0.15:0.1[wave]',
    '[bg][wave]overlay=40:545[b1]',
    `[b1]${dt('title', 46, design.gold, titleX, '178')},`
      + `${dt('subtitle', 26, 'white', '(w-text_w)/2', subtitleY, subtitleFade)},`
      + `${dt('tags', 20, design.cyan, '(w-text_w)/2', '330', tagsPulse)},`
      + `drawbox=x=60:y=878:w=600:h=10:color=${design.track}:t=fill[b2]`,
    `color=c=${design.violet}:s=600x10:r=${design.fps}[bar]`,
    `[b2][bar]overlay=x='60-600+600*t/${duration}':y=878,`
      + `drawbox=x=0:y=869:w=60:h=28:color=${design.panel}:t=fill[b3]`,
    `color=c=${design.gold}:s=18x28:r=${design.fps}[knob]`,
    `[b3][knob]overlay=x='51+600*t/${duration}':y=869[b4]`,
    `[b4]${dt('current', 28, 'white', '60', '919')},`
      + `${dt('total', 24, design.muted, '660-text_w', '919')},format=yuv420p[v]`
  ].join(';');
}

async function writeAudioSourceToFile(source, outputPath, maxBytes = MAX_AUDIO_INPUT_BYTES) {
  const raw = source && typeof source === 'object' && source.stream ? source.stream : source;
  const input = Buffer.isBuffer(raw) ? Readable.from([raw]) : raw;
  if (!input || typeof input[Symbol.asyncIterator] !== 'function') {
    throw new Error('Aucune donnée audio téléchargeable.');
  }

  let bytesWritten = 0;
  const boundedInput = Readable.from((async function* () {
    try {
      for await (const chunk of input) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesWritten += buffer.length;
        if (bytesWritten > maxBytes) {
          throw new Error(`L’audio dépasse la limite de ${maxBytes} octets.`);
        }
        yield buffer;
      }
    } finally {
      if (typeof input.destroy === 'function' && !input.destroyed) input.destroy();
    }
  })());

  await pipeline(boundedInput, fs.createWriteStream(outputPath));
  if (!bytesWritten) throw new Error('Aucune donnée audio téléchargée.');
  return bytesWritten;
}

async function renderAudioStatus(source, {
  durationSeconds = 0,
  maxDurationSeconds = 0,
  maxInputBytes = MAX_AUDIO_INPUT_BYTES,
  maxOutputBytes = MAX_AUDIO_OUTPUT_BYTES,
  branding = BRANDING,
  design = DESIGN
} = {}, returnFile = false) {
  const ffmpegPath = await resolveFfmpeg();
  const fontPath = findFont();
  if (!fontPath) {
    throw new Error('Police Poppins introuvable : vérifie assets/fonts/Poppins-SemiBold.ttf.');
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kaido-groupstatus-audio-'));
  const inputPath = path.join(tempDir, 'source-audio');
  const outputPath = path.join(tempDir, 'kaido-audio-status.mp4');
  let preserveDirectory = false;

  try {
    const inputLimit = positiveInteger(maxInputBytes, MAX_AUDIO_INPUT_BYTES, 1024, 256 * 1024 * 1024);
    await writeAudioSourceToFile(source, inputPath, inputLimit);
    const probedDuration = await getAudioDuration(ffmpegPath, inputPath);
    const duration = safeDuration(probedDuration, durationSeconds);
    const maxDuration = Number(maxDurationSeconds);
    if (Number.isFinite(maxDuration) && maxDuration > 0 && duration > maxDuration) {
      throw new Error(`L’audio dure ${formatTime(duration)}; la limite de conversion est ${formatTime(maxDuration)}.`);
    }
    const durationText = duration.toFixed(2);

    const writeText = async (filename, content) => {
      const fullPath = path.join(tempDir, filename);
      await fs.promises.writeFile(fullPath, content, 'utf8');
      return fullPath;
    };
    const selectedBranding = { ...BRANDING, ...(branding || {}) };
    const textPaths = {
      title: await writeText('title.txt', selectedBranding.title),
      subtitle: await writeText('subtitle.txt', selectedBranding.subtitle),
      tags: await writeText('tags.txt', selectedBranding.tags),
      current: await writeText(
        'current-time.txt',
        duration >= 3600 ? '%{pts:gmtime:0:%H\\:%M\\:%S}' : '%{pts:gmtime:0:%M\\:%S}'
      ),
      total: await writeText('duration.txt', `/ ${formatTime(duration)}`)
    };
    const graph = buildAudioStatusFilterGraph({
      fontPath,
      textPaths,
      durationSeconds: duration,
      design
    });

    await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-filter_complex_threads', '1',
      '-i', inputPath,
      '-filter_complex', graph,
      '-map', '[v]', '-map', '0:a:0',
      '-t', durationText,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads:v', '1', '-crf', '27', '-pix_fmt', 'yuv420p',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-shortest', '-movflags', '+faststart', outputPath
    ], {
      timeout: Math.min(Math.ceil(duration * 2000) + 60000, 30 * 60 * 1000),
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });

    const output = await fs.promises.stat(outputPath);
    if (!output.size) throw new Error('La conversion audio → vidéo a produit un fichier vide.');
    const outputLimit = positiveInteger(maxOutputBytes, MAX_AUDIO_OUTPUT_BYTES, 1024, 512 * 1024 * 1024);
    if (output.size > outputLimit) {
      throw new Error(`La vidéo convertie dépasse la limite de ${outputLimit} octets.`);
    }
    if (returnFile) {
      preserveDirectory = true;
      let cleaned = false;
      return {
        path: outputPath,
        sizeBytes: output.size,
        durationSeconds: duration,
        async cleanup() {
          if (cleaned) return;
          cleaned = true;
          await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
      };
    }

    return await fs.promises.readFile(outputPath);
  } finally {
    if (!preserveDirectory) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

function audioToStatusVideo(buffer, options = {}) {
  return runAudioStatusJob(() => renderAudioStatus(buffer, options, false));
}

function audioToStatusVideoFile(stream, options = {}) {
  return runAudioStatusJob(() => renderAudioStatus(stream, options, true));
}

module.exports = {
  BRANDING,
  DESIGN,
  FONT_CANDIDATES,
  MAX_AUDIO_INPUT_BYTES,
  MAX_AUDIO_OUTPUT_BYTES,
  MAX_AUDIO_CONCURRENT_JOBS,
  MAX_AUDIO_QUEUED_JOBS,
  safeDuration,
  formatTime,
  escapeFilterPath,
  findFont,
  resolveFfmpeg,
  getAudioDuration,
  buildAudioStatusFilterGraph,
  writeAudioSourceToFile,
  audioToStatusVideo,
  audioToStatusVideoFile,
  getAudioStatusQueueStats,
  _test: { createAudioJobQueue, runAudioStatusJob, positiveInteger }
};
