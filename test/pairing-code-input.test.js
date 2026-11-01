'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPhoneNumber,
  getQuotedContext,
  resolvePairingNumber
} = require('../src/services/pairing-code-input');

const GROUP_JID = '120363000000000000@g.us';
const ACTOR = '50911111111@s.whatsapp.net';
const TARGET = '50922222222@s.whatsapp.net';

test('nettoie un numéro explicite et extrait le numéro d’un JID PN', async () => {
  assert.equal(extractPhoneNumber('+509 (2222) 2222'), '50922222222');
  assert.equal(extractPhoneNumber('50922222222:12@s.whatsapp.net'), '50922222222');
  assert.equal(extractPhoneNumber('246454467731604@lid'), '');

  const result = await resolvePairingNumber({ explicitNumber: '+509 2222-2222' });
  assert.deepEqual(result, { number: '50922222222', source: 'explicit' });
});

test('une réponse à un message cible l’auteur cité, pas la personne qui répond', async () => {
  const msg = {
    key: { remoteJid: GROUP_JID, participant: ACTOR },
    message: {
      extendedTextMessage: {
        text: '.code',
        contextInfo: {
          stanzaId: 'quoted-target',
          participant: TARGET,
          quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } }
        }
      }
    }
  };

  const result = await resolvePairingNumber({
    msg,
    from: GROUP_JID,
    senderJid: ACTOR,
    socket: {}
  });
  assert.deepEqual(result, { number: '50922222222', source: 'reply' });
});

test('résout un LID cité avec le mapping PN Baileys', async () => {
  const quotedLid = '246454467731604:4@lid';
  const normalizedLid = '246454467731604@lid';
  const msg = {
    key: { remoteJid: GROUP_JID, participant: ACTOR },
    message: {
      extendedTextMessage: {
        text: '.code',
        contextInfo: { stanzaId: 'quoted-lid', participant: quotedLid }
      }
    }
  };
  const socket = {
    signalRepository: {
      lidMapping: {
        async getPNForLID(lid) {
          assert.equal(lid, normalizedLid);
          return TARGET;
        }
      }
    }
  };

  const result = await resolvePairingNumber({ msg, from: GROUP_JID, senderJid: ACTOR, socket });
  assert.deepEqual(result, { number: '50922222222', source: 'reply' });
});

test('déduit son propre numéro PN quand `.code` est seul en conversation privée', async () => {
  const msg = {
    key: { remoteJid: ACTOR, fromMe: false },
    message: { conversation: '.code' }
  };
  const result = await resolvePairingNumber({ msg, from: ACTOR, senderJid: ACTOR, socket: {} });
  assert.deepEqual(result, { number: '50911111111', source: 'sender' });
});

test('résout le LID de l’expéditeur pour `.code` sans argument', async () => {
  const senderLid = '246454467731604@lid';
  const msg = {
    key: { remoteJid: senderLid, remoteJidAlt: TARGET, fromMe: false },
    message: { conversation: '.code' }
  };
  const result = await resolvePairingNumber({ msg, from: senderLid, senderJid: senderLid, socket: {} });
  assert.deepEqual(result, { number: '50922222222', source: 'sender' });
});

test('n’utilise pas l’identifiant LID comme s’il était un numéro de téléphone', async () => {
  const senderLid = '246454467731604@lid';
  const msg = { key: { remoteJid: senderLid }, message: { conversation: '.code' } };
  const result = await resolvePairingNumber({ msg, from: senderLid, senderJid: senderLid, socket: {} });
  assert.equal(result.number, '');
  assert.equal(result.source, 'sender');
  assert.match(result.error, /indique le numéro international/i);
});

test('trouve le contexte de réponse dans une enveloppe ephemeral', () => {
  const contextInfo = { stanzaId: 'quoted', participant: TARGET };
  const msg = {
    message: {
      ephemeralMessage: {
        message: {
          extendedTextMessage: { text: '.code', contextInfo }
        }
      }
    }
  };
  assert.equal(getQuotedContext(msg), contextInfo);
});
