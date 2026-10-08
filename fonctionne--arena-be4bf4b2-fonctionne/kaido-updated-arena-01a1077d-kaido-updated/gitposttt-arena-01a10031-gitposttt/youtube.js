const axios = require("axios");
const https = require("https");
const fetch = require("node-fetch");

// URL principale de conversion
const BASE_URL = "https://hub.ytconvert.org/api/download";

// En-têtes HTTP
const headers = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Origin": "https://media.ytmp3.gg",
  "Referer": "https://media.ytmp3.gg/",
  "User-Agent": "Mozilla/5.0"
};

// Fonction utilitaire pour attendre
const attendre = ms => new Promise(res => setTimeout(res, ms));

// Extraire l’ID vidéo YouTube
function extraireIdVideo(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    if (u.hostname.includes("youtu.be")) return u.pathname.split("/")[1];
    if (u.pathname.includes("/shorts/")) return u.pathname.split("/shorts/")[1];
    return null;
  } catch {
    return null;
  }
}

// Construire une miniature
function construireMiniature(url, fallback = null) {
  const id = extraireIdVideo(url);
  if (!id) return fallback;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

// Requête principale de conversion
async function requeteConversion(payload) {
  const res = await axios.post(BASE_URL, payload, { headers, timeout: 20_000 });
  if (!res.data || typeof res.data !== 'object') {
    throw new Error('Réponse invalide du convertisseur YouTube.');
  }
  return res.data;
}

function lienHttp(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

function normaliserResultat(data, fallback = {}) {
  const lien = lienHttp(data?.downloadUrl || data?.download_url || data?.lien || data?.url);
  if (!lien) throw new Error('Le convertisseur n’a retourné aucun lien valide.');
  const titre = data?.title || data?.titre || fallback.titre || 'YouTube Media';
  const miniature = data?.thumbnail || data?.thumbnail_url || data?.miniature || fallback.miniature || null;
  return {
    ...data,
    titre,
    title: titre,
    lien,
    downloadUrl: lien,
    miniature,
    thumbnail: miniature
  };
}

// Attendre que la conversion soit prête, sans boucle infinie.
async function attendrePret(statusUrl, maxAttempts = 40) {
  const safeStatusUrl = lienHttp(statusUrl);
  if (!safeStatusUrl) throw new Error('URL de progression absente ou invalide.');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data } = await axios.get(safeStatusUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 12_000
    });

    if (data?.downloadUrl || data?.download_url) return data;
    if (data?.status === "error" || data?.success === false) {
      throw new Error(data?.message || "L’API a renvoyé une erreur.");
    }
    await attendre(1500);
  }
  throw new Error('Timeout : la conversion YouTube met trop de temps à répondre.');
}

// Conversion principale en MP3
async function primaireMP3(url) {
  const convert = await requeteConversion({
    url,
    os: "windows",
    output: { type: "audio", format: "mp3" }
  });
  const status = await attendrePret(convert.statusUrl || convert.status_url);
  return normaliserResultat(status, {
    titre: convert.title,
    miniature: construireMiniature(url)
  });
}

// Conversion principale en MP4
async function primaireMP4(url, qualite = "720") {
  const convert = await requeteConversion({
    url,
    os: "windows",
    output: { type: "video", format: "mp4", quality: qualite + "p" }
  });
  const status = await attendrePret(convert.statusUrl || convert.status_url);
  return normaliserResultat({ ...status, qualite }, {
    titre: convert.title,
    miniature: construireMiniature(url)
  });
}

// Méthode secondaire
async function secondaireTelechargement(url, type = "mp3", format = "128") {
  const params = type === "mp3" ? { format: "mp3", audio_quality: format, url } : { format, url };
  const { data } = await axios.get("https://p.lbserver.xyz/ajax/download.php", {
    params,
    timeout: 20_000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (data?.download_url || data?.url) {
    return normaliserResultat(data, { titre: data.title, miniature: data.info?.image });
  }
  if (!lienHttp(data?.progress_url)) throw new Error("URL de progression introuvable.");

  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { data: progress } = await axios.get(data.progress_url, {
        timeout: 12_000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (progress?.download_url || progress?.downloadUrl) {
        return normaliserResultat(progress, {
          titre: data.title,
          miniature: data.info?.image || data.thumbnail_url
        });
      }
      if (progress?.success === false || progress?.status === 'error') {
        throw new Error(progress?.message || 'La conversion secondaire a échoué.');
      }
    } catch (error) {
      lastError = error;
    }
    await attendre(1000);
  }
  throw new Error(lastError?.message || 'Timeout : la conversion secondaire met trop de temps à répondre.');
}

// Méthode tertiaire (SaveNow)
const SaveNow = {
  api: "https://p.savenow.to",
  key: "dfcb6d76f2f6a9894gjkege8a4ab232222",
  agent: new https.Agent({ rejectUnauthorized: false })
};

async function tertiaireTelechargement(url, type = "mp3") {
  const format = type === "mp3" ? "mp3" : "720";
  const { data } = await axios.get(`${SaveNow.api}/ajax/download.php`, {
    params: { format, url, api: SaveNow.key },
    httpsAgent: SaveNow.agent
  });

  for (let i = 0; i < 40; i++) {
    try {
      const { data: res } = await axios.get(data.progress_url, { httpsAgent: SaveNow.agent });
      if (res.success && res.download_url) {
        return {
          titre: data.info?.title,
          lien: res.download_url,
          miniature: data.info?.image
        };
      }
    } catch {}
    await attendre(2500);
  }
  throw new Error("Timeout : SaveNow met trop de temps à répondre.");
}

// Méthode quaternaire (SSYoutube)
const SS_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Content-Type': 'application/x-www-form-urlencoded',
  'origin': 'https://ssyoutube.online',
  'referer': 'https://ssyoutube.online/en12/'
};

async function quaternaireTelechargement(url, type = "mp3", qualite = "720") {
  const resolu = type === "mp3" ? "audio" : qualite;
  const r = await fetch("https://ssyoutube.online/yt-video-detail/", {
    method: "POST",
    headers: SS_HEADERS,
    body: new URLSearchParams({ videoURL: url })
  });

  const html = await r.text();
  const titre = (html.match(/videoTitle[^>]*>(.*?)</) || [])[1] || "Inconnu";
  const miniature = (html.match(/thumbnail" src="([^"]+)/) || [])[1];

  if (resolu === "audio") {
    const req = await fetch("https://ssyoutube.online/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: SS_HEADERS,
      body: new URLSearchParams({ action: "get_mp3_conversion_url", videoUrl: url })
    });
    const json = await req.json();
    return { titre, miniature, lien: json.data.url };
  }

  throw new Error("SSYoutube ne supporte que l’extraction MP3 via ce bypass.");
}

// Fonction principale pour MP3
async function ytmp3(url) {
  try {
    return normaliserResultat(await primaireMP3(url));
  } catch (e1) {
    console.error(e1.message || e1);
    try {
      return normaliserResultat(await secondaireTelechargement(url, "mp3"));
    } catch (e2) {
      console.error(e2.message || e2);
      try {
        return normaliserResultat(await tertiaireTelechargement(url, "mp3"));
      } catch (e3) {
        console.error(e3.message || e3);
        try {
          return normaliserResultat(await quaternaireTelechargement(url, "mp3"));
        } catch (e4) {
          console.error(e4.message || e4);
          throw new Error("Tous les serveurs ont échoué pour l’audio.");
        }
      }
    }
  }
}

// Fonction principale pour MP4
async function ytmp4(url, qualite = "720") {
  try {
    return normaliserResultat(await primaireMP4(url, qualite));
  } catch (e1) {
    console.error(e1.message || e1);
    try {
      return normaliserResultat(await secondaireTelechargement(url, "mp4", qualite));
    } catch (e2) {
      console.error(e2.message || e2);
      throw new Error(`Tous les serveurs ont échoué pour la vidéo (${e2.message || e2}).`);
    }
  }
}

module.exports = {
  ytmp3,
  ytmp4,
  _test: { lienHttp, normaliserResultat, extraireIdVideo, construireMiniature }
};