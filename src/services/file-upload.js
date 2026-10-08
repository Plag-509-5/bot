'use strict';

const axios = require('axios');
const FormData = require('form-data');

const UPLOAD_TIMEOUT_MS = Math.max(15_000, Number(process.env.TOURL_TIMEOUT_MS) || 60_000);
const MAX_UPLOAD_BYTES = Math.max(5 * 1024 * 1024, Number(process.env.TOURL_MAX_BYTES) || 100 * 1024 * 1024);
const USER_AGENT = 'KAIDO-MD/2.0 (WhatsApp media uploader)';

function safeFilename(value, fallback = 'kaido-file.bin') {
  const cleaned = String(value || '')
    .replace(/[/\\?%*:|"<>\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(-120);
  return cleaned || fallback;
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function uploadHeaders(form, extra = {}) {
  return {
    ...form.getHeaders(),
    Accept: 'application/json, text/plain, */*',
    'User-Agent': USER_AGENT,
    ...extra
  };
}

function requestOptions(form, extra = {}) {
  return {
    headers: uploadHeaders(form, extra.headers),
    timeout: UPLOAD_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: status => status >= 200 && status < 300
  };
}

function appendFile(form, field, buffer, filename, mimetype) {
  form.append(field, buffer, {
    filename: safeFilename(filename),
    contentType: mimetype || 'application/octet-stream',
    knownLength: buffer.length
  });
}

async function uploadUguu(buffer, filename, mimetype, http = axios) {
  const form = new FormData();
  appendFile(form, 'files[]', buffer, filename, mimetype);
  const response = await http.post('https://uguu.se/upload', form, requestOptions(form));
  const data = response.data;
  const url = validHttpUrl(
    data?.files?.[0]?.url ||
    data?.files?.[0] ||
    data?.url ||
    (typeof data === 'string' ? data : '')
  );
  if (!url) throw new Error('Uguu a renvoyé une réponse sans URL.');
  return url;
}

async function uploadCatbox(buffer, filename, mimetype, http = axios) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  if (process.env.CATBOX_USER_HASH) form.append('userhash', process.env.CATBOX_USER_HASH);
  appendFile(form, 'fileToUpload', buffer, filename, mimetype);
  const response = await http.post('https://catbox.moe/user/api.php', form, requestOptions(form));
  const url = validHttpUrl(response.data);
  if (!url) throw new Error('Catbox a renvoyé une réponse sans URL.');
  return url;
}

async function upload0x0(buffer, filename, mimetype, http = axios) {
  const form = new FormData();
  appendFile(form, 'file', buffer, filename, mimetype);
  const response = await http.post('https://0x0.st', form, requestOptions(form));
  const url = validHttpUrl(response.data);
  if (!url) throw new Error('0x0.st a renvoyé une réponse sans URL.');
  return url;
}

async function uploadTmpFiles(buffer, filename, mimetype, http = axios) {
  const form = new FormData();
  appendFile(form, 'file', buffer, filename, mimetype);
  const response = await http.post('https://tmpfiles.org/api/v1/upload', form, requestOptions(form));
  const pageUrl = validHttpUrl(response.data?.data?.url || response.data?.url);
  if (!pageUrl) throw new Error('TmpFiles a renvoyé une réponse sans URL.');
  return pageUrl.replace('://tmpfiles.org/', '://tmpfiles.org/dl/');
}

function describeUploadError(error) {
  const status = error?.response?.status;
  if (status) return `HTTP ${status}`;
  if (error?.code === 'ECONNABORTED') return 'délai dépassé';
  return String(error?.message || error || 'erreur inconnue').slice(0, 120);
}

async function uploadBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Le fichier à téléverser est vide.');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Fichier trop volumineux (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Limite : ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB.`);
  }

  const filename = safeFilename(options.filename);
  const mimetype = options.mimetype || 'application/octet-stream';
  const http = options.http || axios;
  const providers = options.providers || [
    { name: 'Uguu', upload: uploadUguu },
    { name: 'Catbox', upload: uploadCatbox },
    { name: '0x0.st', upload: upload0x0 },
    { name: 'TmpFiles', upload: uploadTmpFiles }
  ];
  const failures = [];

  // Séquentiel volontairement : dès qu'un hébergeur fonctionne, le média
  // n'est pas inutilement copié sur trois autres services publics.
  for (const provider of providers) {
    try {
      const url = await provider.upload(buffer, filename, mimetype, http);
      const safeUrl = validHttpUrl(url);
      if (!safeUrl) throw new Error('URL finale invalide.');
      return { url: safeUrl, provider: provider.name, failures };
    } catch (error) {
      failures.push({ provider: provider.name, error: describeUploadError(error) });
      console.warn(`[TOURL] ${provider.name} indisponible: ${describeUploadError(error)}`);
    }
  }

  const details = failures.map(item => `${item.provider}: ${item.error}`).join(' · ');
  throw new Error(`Tous les hébergeurs sont indisponibles. ${details}`);
}

module.exports = {
  UPLOAD_TIMEOUT_MS,
  MAX_UPLOAD_BYTES,
  safeFilename,
  validHttpUrl,
  uploadUguu,
  uploadCatbox,
  upload0x0,
  uploadTmpFiles,
  describeUploadError,
  uploadBuffer
};
