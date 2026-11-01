'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tostatus = require('../src/plugins/owner/tostatus');
const selector = require('../src/services/group-status-selector');

function makeHarness({
  args = ['add'],
  sessionViewers = [],
  quotedMsg,
  prefix = '!',
  owner = true,
  from = '50911111111@s.whatsapp.net'
} = {}) {
  const sent = [];
  const writes = [];
  const socket = {
    user: { id: '50900000000:3@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `sent-${sent.length}` } };
    }
  };
  const msg = {
    key: { id: 'incoming', remoteJid: from },
    message: { extendedTextMessage: { text: `${prefix}tostatus ${args.join(' ')}` } }
  };
  const context = {
    socket,
    msg,
    from,
    args,
    prefix,
    command: 'tostatus',
    quotedMsg,
    sender: from,
    senderNumber: '50911111111',
    sessionNumber: '50900000000@s.whatsapp.net',
    sessionCfg: { STATUS_VIEWERS: sessionViewers },
    isOwner: owner,
    isSessionOwner: false,
    setUserConfigInMongo: async (number, config) => {
      writes.push({ number, config });
      return true;
    }
  };
  return { socket, context, sent, writes };
}

test('.tostatus add fusionne les numéros du texte cité sans remplacer le public courant', async () => {
  const h = makeHarness({
    args: ['add'],
    sessionViewers: ['50911111111', '50922222222'],
    quotedMsg: { conversation: 'Contacts : +509 2222 2222\n509-333-33333' }
  });

  await tostatus.execute(h.context);

  assert.deepEqual(h.writes[0].config.STATUS_VIEWERS, [
    '50911111111', '50922222222', '50933333333'
  ]);
  assert.match(h.sent.at(-1).content.text, /1 numéro\(s\) ajouté\(s\), 1 déjà présent\(s\), 3 au total/);
});

test('.tostatus add lit un fichier .txt cité via le téléchargeur du socket existant', async () => {
  const quotedMsg = {
    documentMessage: {
      fileName: 'liste.txt',
      mimetype: 'text/plain',
      fileLength: 25
    }
  };
  const h = makeHarness({ args: ['add'], quotedMsg });
  const dependencies = {
    downloadContentFromMessage: async (document, type) => {
      assert.equal(document.fileName, 'liste.txt');
      assert.equal(type, 'document');
      return (async function* () {
        yield Buffer.from('+509 5555 1111\n50966662222\n', 'utf8');
      })();
    }
  };

  await tostatus.execute(h.context, dependencies);

  assert.deepEqual(h.writes[0].config.STATUS_VIEWERS, ['50955551111', '50966662222']);
  assert.match(h.sent.at(-1).content.text, /2 numéro\(s\) ajouté\(s\)/);
});

test('.tostatus add importe une vCard de contact', async () => {
  const h = makeHarness({
    args: ['add'],
    quotedMsg: {
      contactMessage: {
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Test\nTEL;TYPE=CELL:+509-7777-3333\nEND:VCARD'
      }
    }
  });

  await tostatus.execute(h.context);

  assert.deepEqual(h.writes[0].config.STATUS_VIEWERS, ['50977773333']);
});

test('.tostatus add lit aussi un fichier vCard .vcf cité', async () => {
  const h = makeHarness({
    args: ['add'],
    quotedMsg: { documentMessage: { fileName: 'contacts.vcf', mimetype: 'text/vcard' } }
  });
  const dependencies = {
    downloadContentFromMessage: async () => (async function* () {
      yield Buffer.from('BEGIN:VCARD\nFN:Contact\nTEL;TYPE=CELL:+509-8888-4444\nEND:VCARD', 'utf8');
    })()
  };

  await tostatus.execute(h.context, dependencies);

  assert.deepEqual(h.writes[0].config.STATUS_VIEWERS, ['50988884444']);
});

test('.tostatus export envoie un TXT trié par ordre numérique', async () => {
  const h = makeHarness({
    args: ['export'],
    sessionViewers: ['50999999999', '50911111111', '50955555555']
  });

  await tostatus.execute(h.context);

  const file = h.sent.at(-1).content;
  assert.equal(file.fileName, 'public-statut-50900000000.txt');
  assert.equal(file.mimetype, 'text/plain');
  assert.match(file.document.toString('utf8'), /\+50911111111\n\+50955555555\n\+50999999999/);
});

test('.tostatus new group affiche le nombre de membres et marque une sélection distincte', async () => {
  const h = makeHarness({ args: ['new', 'group'] });
  h.socket.groupFetchAllParticipating = async () => ({
    '120363123@g.us': {
      id: '120363123@g.us',
      subject: 'Famille',
      participants: [
        { id: '50911111111@s.whatsapp.net' },
        { id: '50900000000@s.whatsapp.net' },
        { id: '50922222222@s.whatsapp.net' }
      ]
    }
  });

  await tostatus.execute(h.context);

  assert.match(h.sent.at(-1).content.text, /Famille — 3 membre\(s\)/);
  const selection = selector.resolveGroupSelection(
    '50900000000',
    '50911111111@s.whatsapp.net',
    '1'
  );
  assert.equal(selection.status, 'selected');
  assert.equal(selection.purpose, tostatus.STATUS_AUDIENCE_SELECTION_PURPOSE);
});

test('une identité LID peut être appariée au même propriétaire en conversation privée', async () => {
  const socket = {
    signalRepository: {
      lidMapping: {
        getPNsForLIDs: async lids => [{ lid: lids[0], pn: '50911111111@s.whatsapp.net' }]
      }
    }
  };
  const actors = await tostatus._test.expandStatusSelectionActorIds(socket, ['100000000000001@lid']);
  assert.ok(actors.includes('50911111111@s.whatsapp.net'));
});

test('la sélection de groupe ajoute les numéros à la configuration de session', async () => {
  const h = makeHarness({ sessionViewers: ['50911111111'] });
  h.socket.groupMetadata = async jid => ({
    id: jid,
    subject: 'Amis',
    participants: [
      { id: '50922222222@s.whatsapp.net' },
      { id: '50911111111@s.whatsapp.net' }
    ]
  });

  const result = await tostatus.completeStatusAudienceGroupSelection(h.context, {
    jid: '120363123@g.us',
    subject: 'Amis'
  });

  assert.deepEqual(result.numbers, ['50911111111', '50922222222']);
  assert.equal(result.added, 1);
  assert.deepEqual(h.writes[0].config.STATUS_VIEWERS, result.numbers);
});

test('l’import reste réservé au propriétaire ou au propriétaire de session', async () => {
  const h = makeHarness({ args: ['add'], owner: false });
  h.context.isSessionOwner = false;
  h.context.quotedMsg = { conversation: '50922222222' };

  await tostatus.execute(h.context);

  assert.equal(h.writes.length, 0);
  assert.match(h.sent.at(-1).content.text, /Seul le propriétaire/);
});
