'use strict';

const MEDIA_LABELS = Object.freeze({
  imageMessage: 'une image',
  videoMessage: 'une vidéo',
  ptvMessage: 'une vidéo courte',
  audioMessage: 'un message vocal ou audio',
  documentMessage: 'un document',
  stickerMessage: 'un autocollant',
  locationMessage: 'une position',
  liveLocationMessage: 'une position en direct',
  contactMessage: 'une fiche contact',
  contactsArrayMessage: 'des fiches contact',
  pollCreationMessage: 'un sondage',
  pollCreationMessageV2: 'un sondage',
  pollCreationMessageV3: 'un sondage',
  eventMessage: 'un événement',
  productMessage: 'un produit',
  orderMessage: 'une commande'
});

const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage'
];

function unwrapContent(message) {
  let content = message;
  for (let depth = 0; depth < 5 && content && typeof content === 'object'; depth += 1) {
    const wrapperKey = WRAPPER_KEYS.find(key => content[key]?.message);
    if (!wrapperKey) break;
    content = content[wrapperKey].message;
  }
  return content && typeof content === 'object' ? content : {};
}

function findMediaType(content) {
  for (const key of Object.keys(MEDIA_LABELS)) {
    if (content?.[key]) return key;
  }
  return '';
}

function extractMessageText(content) {
  return String(
    content?.conversation
      || content?.extendedTextMessage?.text
      || content?.imageMessage?.caption
      || content?.videoMessage?.caption
      || content?.documentMessage?.caption
      || content?.buttonsResponseMessage?.selectedButtonId
      || content?.listResponseMessage?.singleSelectReply?.selectedRowId
      || content?.interactiveResponseMessage?.body?.text
      || ''
  ).replace(/\u0000/g, '').trim();
}

function getChatbotInput(message, body = '') {
  const content = unwrapContent(message?.message || message);
  const suppliedText = String(body || '').replace(/\u0000/g, '').trim();
  const text = suppliedText || extractMessageText(content);
  const mediaType = findMediaType(content);
  const label = MEDIA_LABELS[mediaType];

  if (text) return label ? `L’utilisateur a envoyé ${label} avec ce texte ou cette légende : ${text}` : text;
  if (!label) return null;

  if (mediaType === 'audioMessage') {
    return 'L’utilisateur a envoyé un message vocal ou audio. Le fichier audio n’est pas transmis à l’IA et aucune transcription n’est disponible; réponds avec tact et demande une transcription si nécessaire.';
  }
  if (mediaType === 'imageMessage' || mediaType === 'videoMessage' || mediaType === 'ptvMessage') {
    return `L’utilisateur a envoyé ${label} sans légende. Le fichier média n’est pas transmis à l’IA; indique simplement que tu l’as reçu et demande ce qu’il souhaite en faire.`;
  }
  if (mediaType === 'locationMessage' || mediaType === 'liveLocationMessage') {
    return `L’utilisateur a partagé ${label}. Les coordonnées ne sont pas transmises à l’IA; réponds sans essayer de deviner son emplacement.`;
  }
  if (mediaType === 'contactMessage' || mediaType === 'contactsArrayMessage') {
    return `L’utilisateur a partagé ${label}. Les coordonnées du contact ne sont pas transmises à l’IA.`;
  }
  return `L’utilisateur a envoyé ${label} sans texte.`;
}

module.exports = {
  MEDIA_LABELS,
  unwrapContent,
  findMediaType,
  extractMessageText,
  getChatbotInput
};
