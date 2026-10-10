'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
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
function buildAudioStatusFilterGraph({ fontPath, textPaths, durationSeconds }) {
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
    `color=c=${DESIGN.background}:s=${DESIGN.width}x${DESIGN.height}:r=${DESIGN.fps},`
      + `drawbox=x=0:y=0:w=${DESIGN.width}:h=9:color=${DESIGN.violet}:t=fill,`
      + `drawbox=x=0:y=${DESIGN.height - 9}:w=${DESIGN.width}:h=9:color=${DESIGN.cyan}:t=fill,`
      + `drawbox=x=30:y=480:w=660:h=455:color=${DESIGN.panel}:t=fill,`
      + `drawbox=x=30:y=480:w=660:h=4:color=${DESIGN.violet}:t=fill,`
      + `drawbox=x=30:y=931:w=660:h=4:color=${DESIGN.cyan}:t=fill[bg]`,
    `[0:a:0]showwaves=s=640x300:mode=cline:rate=${DESIGN.fps}:colors=${DESIGN.cyan},`
      + 'format=rgba,colorkey=0x000000:0.15:0.1[wave]',
    '[bg][wave]overlay=40:545[b1]',
    `[b1]${dt('title', 46, DESIGN.gold, titleX, '178')},`
      + `${dt('subtitle', 26, 'white', '(w-text_w)/2', subtitleY, subtitleFade)},`
      + `${dt('tags', 20, DESIGN.cyan, '(w-text_w)/2', '330', tagsPulse)},`
      + 'drawbox=x=60:y=878:w=600:h=10:color=0x282B42:t=fill[b2]',
    `color=c=${DESIGN.violet}:s=600x10:r=${DESIGN.fps}[bar]`,
    `[b2][bar]overlay=x='60-600+600*t/${duration}':y=878,`
      + `drawbox=x=0:y=869:w=60:h=28:color=${DESIGN.panel}:t=fill[b3]`,
    `color=c=${DESIGN.gold}:s=18x28:r=${DESIGN.fps}[knob]`,
    `[b3][knob]overlay=x='51+600*t/${duration}':y=869[b4]`,
    `[b4]${dt('current', 28, 'white', '60', '919')},`
      + `${dt('total', 24, DESIGN.muted, '660-text_w', '919')},format=yuv420p[v]`
  ].join(';');
}

async function audioToStatusVideo(buffer, { durationSeconds = 0 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Aucune donnée audio téléchargée.');
  }

  const ffmpegPath = await resolveFfmpeg();
  const fontPath = findFont();
  if (!fontPath) {
    throw new Error('Police Poppins introuvable : vérifie assets/fonts/Poppins-SemiBold.ttf.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaido-groupstatus-audio-'));
  const inputPath = path.join(tempDir, 'source-audio');
  const outputPath = path.join(tempDir, 'kaido-audio-status.mp4');

  try {
    await fs.promises.writeFile(inputPath, buffer);
    const probedDuration = await getAudioDuration(ffmpegPath, inputPath);
    const duration = safeDuration(probedDuration, durationSeconds);
    const durationText = duration.toFixed(2);

    const writeText = async (filename, content) => {
      const fullPath = path.join(tempDir, filename);
      await fs.promises.writeFile(fullPath, content, 'utf8');
      return fullPath;
    };
    const textPaths = {
      title: await writeText('title.txt', BRANDING.title),
      subtitle: await writeText('subtitle.txt', BRANDING.subtitle),
      tags: await writeText('tags.txt', BRANDING.tags),
      current: await writeText(
        'current-time.txt',
        duration >= 3600 ? '%{pts:gmtime:0:%H\\:%M\\:%S}' : '%{pts:gmtime:0:%M\\:%S}'
      ),
      total: await writeText('duration.txt', `/ ${formatTime(duration)}`)
    };
    const graph = buildAudioStatusFilterGraph({ fontPath, textPaths, durationSeconds: duration });

    await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-filter_complex', graph,
      '-map', '[v]', '-map', '0:a:0',
      '-t', durationText,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-shortest', '-movflags', '+faststart', outputPath
    ], {
      timeout: Math.min(Math.ceil(duration * 2000) + 60000, 30 * 60 * 1000),
      maxBuffer: 8 * 1024 * 1024
    });

    const video = await fs.promises.readFile(outputPath);
    if (!video.length) throw new Error('La conversion audio → vidéo a produit un fichier vide.');
    return video;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  BRANDING,
  DESIGN,
  FONT_CANDIDATES,
  safeDuration,
  formatTime,
  escapeFilterPath,
  findFont,
  resolveFfmpeg,
  getAudioDuration,
  buildAudioStatusFilterGraph,
  audioToStatusVideo
};
