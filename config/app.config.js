require('dotenv').config();

module.exports = {
    // Statut & Activités automatiques
    AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS || 'true',
    AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS || 'true',
    AUTO_RECORDING: process.env.AUTO_RECORDING || 'false',
    AUTO_LIKE_EMOJI: ['🐉', '🔥', '💀', '👑', '💪', '😎', '🇭🇹', '⚡', '🩸', '❤️', '🌟', '🍉', '🧩'],
    
    // Paramètres du bot
    PREFIX: process.env.PREFIX || '.',
    MAX_RETRIES: 3,
    BOT_NAME: process.env.BOT_NAME || 'KAIDO-MD',
    BOT_VERSION: '2.0.0',
    OWNER_NAME: process.env.OWNER_NAME || 'Mugiwara no plag',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '50947440869',
    BOT_FOOTER: process.env.BOT_FOOTER || '> 𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐏𝐋4𝐆 x *TECH MONDIAL* 👑',
    
    // Liens & Médias
    GROUP_INVITE_LINK: process.env.GROUP_INVITE_LINK || 'https://chat.whatsapp.com/DLK3kh1Ze2qHUfNKCZ3iXN',
    CHANNEL_LINK: process.env.CHANNEL_LINK || 'https://whatsapp.com/channel/0029Vb6FwIK89inhtCZOlp12',
    IMAGE_PATH: process.env.IMAGE_PATH || 'https://files.catbox.moe/l1lzbx.png',
    RCD_IMAGE_PATH: process.env.RCD_IMAGE_PATH || 'https://files.catbox.moe/l1lzbx.png',
    
    // Newsletters & Sécurité
    NEWSLETTER_JID: process.env.NEWSLETTER_JID || '120363421675697127@newsletter',
    OTP_EXPIRY: 300000,
    ADMIN_PASS: process.env.ADMIN_PASS || '',
    
    // Base de données MongoDB (obligatoire, aucun identifiant par défaut)
    MONGO_URI: process.env.MONGO_URI || '',
    MONGO_DB: process.env.MONGO_DB || 'MUGIWARA_NO_PLAG',

    // Clés API Optionnelles
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || ''
};
