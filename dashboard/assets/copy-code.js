/**
 * copy-code.js — copie du code d'appairage, quel que soit le contexte.
 *
 * Le bug
 * ------
 * `navigator.clipboard` n'existe QUE dans un **contexte sécurisé** : HTTPS ou
 * `localhost`. Or ce bot est couramment servi en HTTP simple (IP:port, domaine
 * sans TLS, iframe de prévisualisation). Dans ces cas `navigator.clipboard`
 * vaut `undefined` et `navigator.clipboard.writeText(...)` lève une TypeError.
 *
 * Comme `copyCode()` était `async` et appelée depuis un `onclick` inline,
 * l'erreur se transformait en rejet de promesse non géré : **rien n'était copié
 * et aucun retour visuel n'apparaissait**. Le clic semblait simplement mort.
 *
 * Trois niveaux de repli, dans l'ordre :
 *   1. Clipboard API            — contexte sécurisé
 *   2. execCommand('copy')      — HTTP simple, vieux navigateurs, iframe
 *   3. sélection du texte       — l'utilisateur copie à la main
 *
 * Le module est UMD : chargeable par une balise <script> (il expose
 * `window.KaidoCopy`) et par `require()` en Node, ce qui permet de tester la
 * vraie logique avec un `navigator` et un `document` factices.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KaidoCopy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Niveau 1 : Clipboard API. Lève une erreur si indisponible ou refusée. */
  async function copyViaClipboardApi(text) {
    const nav = globalThis.navigator;
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') {
      throw new Error('Clipboard API indisponible (contexte non sécurisé)');
    }
    await nav.clipboard.writeText(text);
  }

  /** Niveau 2 : textarea temporaire + execCommand. Fonctionne en HTTP simple. */
  function copyViaExecCommand(text) {
    const doc = globalThis.document;
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
      throw new Error('document indisponible');
    }
    if (typeof doc.execCommand !== 'function') {
      throw new Error('execCommand indisponible');
    }

    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // Hors flux et invisible : évite de faire défiler la page au focus.
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.left = '-1000px';
    area.style.opacity = '0';
    doc.body.appendChild(area);

    const selection = typeof doc.getSelection === 'function' ? doc.getSelection() : null;
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    area.focus({ preventScroll: true });
    area.select();
    // Nécessaire sur iOS Safari, où select() seul ne suffit pas.
    if (typeof area.setSelectionRange === 'function') area.setSelectionRange(0, text.length);

    let succeeded = false;
    try {
      succeeded = doc.execCommand('copy');
    } catch (err) {
      succeeded = false;
    }

    doc.body.removeChild(area);
    if (selection && previousRange) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }

    if (!succeeded) throw new Error('execCommand("copy") a échoué');
  }

  /** Niveau 3 : sélection visible, pour une copie manuelle. */
  function selectText(value) {
    const doc = globalThis.document;
    if (!doc || typeof doc.getSelection !== 'function' || !doc.body) return false;
    const area = doc.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0.01';
    doc.body.appendChild(area);
    area.focus({ preventScroll: true });
    area.select();
    // On garde le textarea en place quelques secondes pour laisser le temps de
    // faire Ctrl+C, puis on le retire.
    setTimeout(() => {
      try { doc.body.removeChild(area); } catch (err) { /* déjà retiré */ }
    }, 8000);
    return true;
  }

  /**
   * Copie `text` en essayant les trois niveaux.
   * Ne lève JAMAIS d'erreur : renvoie toujours un résultat exploitable, pour que
   * l'interface puisse afficher un retour visuel dans tous les cas.
   *
   * @returns {Promise<{copied: boolean, method: 'clipboard'|'execCommand'|'manuel', error?: string}>}
   */
  async function copyText(text) {
    const value = String(text === null || text === undefined ? '' : text).trim();
    if (!value) return { copied: false, method: 'manuel', error: 'rien à copier' };

    try {
      await copyViaClipboardApi(value);
      return { copied: true, method: 'clipboard' };
    } catch (clipboardError) {
      try {
        copyViaExecCommand(value);
        return { copied: true, method: 'execCommand' };
      } catch (execError) {
        selectText(value);
        return {
          copied: false,
          method: 'manuel',
          error: (execError && execError.message) || String(execError || clipboardError)
        };
      }
    }
  }

  /**
   * Lit le code à copier depuis un élément.
   *
   * `data-code` est prioritaire : le texte affiché peut être transformé
   * (« Code copié ! », espaces insécables, mise en forme), alors que l'attribut
   * reste la valeur exacte. En repli, on retire l'étiquette du texte visible.
   */
  function readCode(element, options = {}) {
    if (!element) return '';
    const { label = 'CODE' } = options;

    const fromAttribute = element.getAttribute
      ? String(element.getAttribute('data-code') || '').trim()
      : '';
    if (fromAttribute) return fromAttribute;

    const text = String(element.textContent || element.innerText || '').trim();
    // « CODE : 12345678 », « CODE: 12345678 », « Code copié ! »…
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleaned = text.replace(new RegExp(`^${escaped}\\s*:?\\s*`, 'i'), '').trim();
    // Un retour visuel encore affiché n'est pas un code.
    if (!cleaned || /copi/i.test(cleaned)) return '';
    return cleaned;
  }

  /**
   * Branche la copie sur un élément : clic + clavier (Entrée/Espace).
   *
   * @param {object} element élément à rendre copiable
   * @param {object} options
   *   getCode()        renvoie le texte à copier (défaut : readCode(element))
   *   successHtml      HTML affiché en cas de succès
   *   manualHtml       HTML affiché quand la copie automatique a échoué
   *   restoreMs        durée avant restauration de l'affichage (défaut 2000)
   * @returns {function(): Promise<object>} la fonction de copie
   */
  function bindCodeCopy(element, options = {}) {
    const {
      getCode = null,
      successHtml = null,
      manualHtml = null,
      restoreMs = 2000,
      label = 'CODE'
    } = options;

    if (!element) return async () => ({ copied: false, method: 'manuel', error: 'élément absent' });

    let timer = null;

    async function run() {
      const value = typeof getCode === 'function' ? String(getCode() || '').trim() : readCode(element, { label });
      const originalHtml = element.innerHTML;
      const result = await copyText(value);

      if (timer) clearTimeout(timer);

      if (result.copied && successHtml) {
        element.classList.add('copied');
        element.innerHTML = successHtml;
      } else if (!result.copied && manualHtml) {
        element.classList.add('copy-failed');
        element.innerHTML = manualHtml;
      }

      timer = setTimeout(() => {
        element.classList.remove('copied');
        element.classList.remove('copy-failed');
        element.innerHTML = originalHtml;
      }, restoreMs);

      return result;
    }

    element.addEventListener('click', (event) => {
      event.preventDefault();
      void run();
    });
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault();
      void run();
    });

    // Accessibilité : l'élément devient atteignable au clavier.
    if (element.setAttribute) {
      if (!element.getAttribute('role')) element.setAttribute('role', 'button');
      if (!element.getAttribute('tabindex')) element.setAttribute('tabindex', '0');
    }

    return run;
  }

  return {
    copyText,
    copyViaClipboardApi,
    copyViaExecCommand,
    selectText,
    readCode,
    bindCodeCopy
  };
});
