'use strict';

function buildChannelInfoInteractiveMessage({ infoText, botName = 'KAIDO-MD', copyCode } = {}) {
  const title = `${String(botName || 'KAIDO-MD').slice(0, 60)} • Channel`;
  const code = String(copyCode || '').slice(0, 512);
  return {
    messageContextInfo: {},
    interactiveMessage: {
      body: { text: String(infoText || '') },
      footer: { text: `© ${botName || 'KAIDO-MD'}` },
      header: { title, hasMediaAttachment: false },
      nativeFlowMessage: {
        messageVersion: 3,
        buttons: [{
          name: 'cta_copy',
          buttonParamsJson: JSON.stringify({
            display_text: '📋 Copier l’ID',
            id: 'copy_channel_id',
            copy_code: code
          })
        }]
      }
    }
  };
}

module.exports = { buildChannelInfoInteractiveMessage };
