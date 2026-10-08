'use strict';

/**
 * Tests de la copie du code d'appairage.
 *
 * Le cas central : `navigator.clipboard` vaut `undefined` en contexte non
 * sécurisé (HTTP simple, iframe). L'ancien code appelait
 * `navigator.clipboard.writeText(...)` sans garde ni repli : TypeError, rejet de
 * promesse non géré, rien de copié et aucun retour visuel.
 */

const test = require('node:test');
const assert = require('node:assert');

const KaidoCopy = require('../dashboard/assets/copy-code.js');

/** DOM minimal, suffisant pour textarea + execCommand + sélection. */
function fakeDocument(options = {}) {
  const { execCommandResult = true, execCommandThrows = false } = options;
  const body = {
    children: [],
    appendChild(node) { this.children.push(node); return node; },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
      return node;
    }
  };
  const ranges = [];
  const doc = {
    body,
    execCommandCalls: 0,
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(),
        value: '',
        style: {},
        attrs: {},
        focused: false,
        selected: null,
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
        focus() { this.focused = true; },
        select() { this.selected = this.value; },
        setSelectionRange(start, end) { this.selected = this.value.slice(start, end); }
      };
      return node;
    },
    getSelection() {
      return {
        rangeCount: ranges.length,
        getRangeAt: (i) => ranges[i],
        removeAllRanges() { ranges.length = 0; },
        addRange(range) { ranges.push(range); }
      };
    },
    execCommand(command) {
      doc.execCommandCalls += 1;
      doc.lastCommand = command;
      if (execCommandThrows) throw new Error('execCommand interdit');
      return execCommandResult;
    }
  };
  return doc;
}

/**
 * Installe un `navigator` et un `document` factices le temps d'un appel.
 *
 * Node >= 21 expose un `navigator` global en lecture seule (getter uniquement) :
 * une simple affectation lève « Cannot set property navigator ». On passe donc
 * par definePropertyDescriptor, et on restaure le descripteur d'origine ensuite.
 *
 * La fonction est asynchrone : les globals doivent rester en place pendant tout
 * le travail asynchrone de copyText, pas seulement jusqu'au premier await.
 */
async function withGlobals({ clipboard, document: doc }, run) {
  const navDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const docDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

  function install(name, value, hadDescriptor) {
    if (value === undefined) {
      if (hadDescriptor) delete globalThis[name];
      return;
    }
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }

  try {
    install('navigator', clipboard === undefined ? undefined : (clipboard === null ? {} : { clipboard }), Boolean(navDescriptor));
    install('document', doc, Boolean(docDescriptor));
    return await run();
  } finally {
    if (navDescriptor) Object.defineProperty(globalThis, 'navigator', navDescriptor);
    else delete globalThis.navigator;
    if (docDescriptor) Object.defineProperty(globalThis, 'document', docDescriptor);
    else delete globalThis.document;
  }
}

test('le module expose window.KaidoCopy pour les pages HTML', () => {
  assert.equal(typeof globalThis.KaidoCopy, 'object');
  for (const name of ['copyText', 'readCode', 'bindCodeCopy', 'selectText']) {
    assert.equal(typeof globalThis.KaidoCopy[name], 'function', `${name} manquant`);
  }
});

test('contexte sécurisé : la Clipboard API est utilisée', async () => {
  const written = [];
  const doc = fakeDocument();
  const result = await withGlobals(
    { clipboard: { writeText: async (t) => { written.push(t); } }, document: doc },
    () => KaidoCopy.copyText('12345678')
  );

  assert.deepEqual(result, { copied: true, method: 'clipboard' });
  assert.deepEqual(written, ['12345678']);
  assert.equal(doc.execCommandCalls, 0, 'pas besoin du repli');
});

test('HTTP simple : navigator.clipboard undefined -> repli execCommand', async () => {
  const doc = fakeDocument();
  // C'est exactement le cas qui cassait : aucun objet `clipboard`.
  const result = await withGlobals(
    { clipboard: null, document: doc },
    () => KaidoCopy.copyText('12345678')
  );

  assert.equal(result.copied, true, 'la copie doit réussir malgré tout');
  assert.equal(result.method, 'execCommand');
  assert.equal(doc.execCommandCalls, 1);
  assert.equal(doc.lastCommand, 'copy');
  assert.equal(doc.body.children.length, 0, 'le textarea temporaire doit être retiré');
});

test('permission refusée par la Clipboard API -> repli execCommand', async () => {
  const doc = fakeDocument();
  const result = await withGlobals(
    {
      clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } },
      document: doc
    },
    () => KaidoCopy.copyText('87654321')
  );

  assert.equal(result.copied, true);
  assert.equal(result.method, 'execCommand');
});

test('les deux méthodes échouent : résultat « manuel » sans lever d’erreur', async () => {
  const doc = fakeDocument({ execCommandResult: false });
  const result = await withGlobals(
    { clipboard: null, document: doc },
    () => KaidoCopy.copyText('11223344')
  );

  assert.equal(result.copied, false);
  assert.equal(result.method, 'manuel');
  assert.ok(result.error, 'une raison doit être fournie pour l’affichage');
});

test('execCommand qui lève une exception est rattrapé', async () => {
  const doc = fakeDocument({ execCommandThrows: true });
  await assert.doesNotReject(
    withGlobals({ clipboard: null, document: doc }, () => KaidoCopy.copyText('11223344'))
  );
});

test('texte vide : rien à copier, aucune exception', async () => {
  for (const value of ['', '   ', null, undefined]) {
    const result = await withGlobals(
      { clipboard: { writeText: async () => { throw new Error('ne doit pas être appelé'); } } },
      () => KaidoCopy.copyText(value)
    );
    assert.equal(result.copied, false);
    assert.equal(result.error, 'rien à copier', `valeur testée : ${JSON.stringify(value)}`);
  }
});

test('le texte est nettoyé avant copie', async () => {
  const written = [];
  const result = await withGlobals(
    { clipboard: { writeText: async (t) => { written.push(t); } } },
    () => KaidoCopy.copyText('  12345678 \n')
  );
  assert.equal(result.copied, true);
  assert.deepEqual(written, ['12345678']);
});

test('readCode préfère data-code au texte affiché', () => {
  const element = {
    attrs: { 'data-code': '12345678' },
    getAttribute(name) { return this.attrs[name] || null; },
    textContent: 'Code Copié !'
  };
  assert.equal(KaidoCopy.readCode(element, { label: 'CODE' }), '12345678');
});

test('readCode retire l’étiquette quand data-code est absent', () => {
  const base = { getAttribute: () => null };
  const variants = [
    ['CODE : 12345678', '12345678'],
    ['CODE: 12345678', '12345678'],
    ['code :12345678', '12345678'],
    ['  CODE   :   12345678  ', '12345678']
  ];
  for (const [text, expected] of variants) {
    assert.equal(
      KaidoCopy.readCode({ ...base, textContent: text }, { label: 'CODE' }),
      expected,
      `texte testé : ${text}`
    );
  }
});

test('readCode ne renvoie jamais le retour visuel comme un code', () => {
  const element = { getAttribute: () => null, textContent: 'Code copié' };
  assert.equal(KaidoCopy.readCode(element, { label: 'CODE' }), '');
});

test('readCode tolère un élément absent', () => {
  assert.equal(KaidoCopy.readCode(null), '');
});

/** Élément factice avec addEventListener, pour tester bindCodeCopy. */
function fakeElement(initialHtml = 'CODE : <span>12345678</span>') {
  const listeners = {};
  const classes = new Set();
  const element = {
    innerHTML: initialHtml,
    classes,
    attrs: {},
    listeners,
    classList: {
      add: (c) => { classes.add(c); },
      remove: (c) => { classes.delete(c); }
    },
    setAttribute(name, value) { element.attrs[name] = String(value); },
    getAttribute(name) { return name in element.attrs ? element.attrs[name] : null; },
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler); },
    dispatch(type, event = {}) {
      let prevented = false;
      const wrapped = { ...event, preventDefault() { prevented = true; } };
      for (const handler of listeners[type] || []) handler(wrapped);
      return prevented;
    }
  };
  return element;
}

test('bindCodeCopy copie au clic et affiche le retour visuel', async () => {
  const written = [];
  const element = fakeElement();

  await withGlobals(
    { clipboard: { writeText: async (t) => { written.push(t); } } },
    async () => {
      KaidoCopy.bindCodeCopy(element, {
        getCode: () => '12345678',
        successHtml: '<i class="fa-solid fa-check"></i> Code Copié !',
        manualHtml: 'Ctrl+C',
        restoreMs: 5
      });
      element.dispatch('click');
      // Laisse la copie asynchrone se terminer.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  );

  assert.deepEqual(written, ['12345678']);
});

test('bindCodeCopy restaure l’affichage après le délai', async () => {
  const element = fakeElement('CODE : <span>12345678</span>');

  await withGlobals(
    { clipboard: { writeText: async () => {} } },
    async () => {
      const run = KaidoCopy.bindCodeCopy(element, {
        getCode: () => '12345678',
        successHtml: 'COPIÉ',
        restoreMs: 40
      });
      // On appelle run() directement : il résout juste après avoir posé le
      // retour visuel, avant l'expiration du minuteur de restauration.
      await run();
      assert.equal(element.innerHTML, 'COPIÉ', 'le retour visuel doit être affiché');
      assert.equal(element.classes.has('copied'), true, 'la classe copied doit être posée');
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(element.innerHTML, 'CODE : <span>12345678</span>', 'l’affichage doit être restauré');
      assert.equal(element.classes.has('copied'), false, 'la classe copied doit être retirée');
    }
  );
});

test('bindCodeCopy est accessible au clavier', async () => {
  const element = fakeElement();

  await withGlobals({ clipboard: { writeText: async () => {} } }, async () => {
    KaidoCopy.bindCodeCopy(element, { getCode: () => '12345678', restoreMs: 5 });
    assert.equal(element.getAttribute('role'), 'button');
    assert.equal(element.getAttribute('tabindex'), '0');
    assert.ok(element.listeners.keydown?.length, 'un gestionnaire clavier doit être posé');
    assert.ok(element.dispatch('keydown', { key: 'Enter' }), 'Entrée doit être interceptée');
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

test('bindCodeCopy sur un élément absent ne lève pas', async () => {
  const run = KaidoCopy.bindCodeCopy(null, {});
  const result = await run();
  assert.equal(result.copied, false);
  assert.equal(result.error, 'élément absent');
});
