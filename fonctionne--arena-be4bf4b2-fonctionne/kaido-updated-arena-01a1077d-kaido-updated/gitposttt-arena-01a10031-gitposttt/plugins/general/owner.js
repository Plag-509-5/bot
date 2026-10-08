module.exports = {
  name: 'owner',
  alias: ['creator', 'dev', 'developpeur', 'adminbot'],
  category: 'general',
  description: 'Affiche les informations de contact du propriétaire du bot',
  usage: '.owner',
  async execute({ socket, msg, from, config }) {
    const ownerNumber = (config?.OWNER_NUMBER || '50947440869').split(',')[0].replace(/[^0-9]/g, '');
    const ownerName = config?.OWNER_NAME || 'Mugiwara no plag';

    const vcard = 'BEGIN:VCARD\n' // metadata of the contact card
      + 'VERSION:3.0\n' 
      + `FN:${ownerName}\n` // full name
      + `ORG:Tech Mondial Dev Team;\n` // the organization of the contact
      + `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}\n` // WhatsApp ID + phone number
      + 'END:VCARD';

    await socket.sendMessage(from, {
      contacts: {
        displayName: ownerName,
        contacts: [{ vcard }]
      }
    }, { quoted: msg });

    await socket.sendMessage(from, {
      text: `👑 *Propriétaire :* ${ownerName}\n📱 *Numéro :* https://wa.me/${ownerNumber}\n📢 *Canal officiel :* ${config?.CHANNEL_LINK || 'https://whatsapp.com/channel/0029Vb6FwIK89inhtCZOlp12'}`
    }, { quoted: msg });
  }
};
