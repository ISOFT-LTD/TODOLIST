/**
 * The plugin's text, read from the application's translations.
 *
 * There is one set of translations, the Core's. The Core loads it and hands
 * this plugin a way to read it, sdk.i18n, and nothing of how it is kept:
 *
 *   sdk.i18n.translate(key)       the text for a key, in the user's language
 *   sdk.i18n.subscribe(listener)  be told when the translations have changed
 *
 * This module is the plugin's counterpart of the React helper in the Core's
 * skeleton (usePluginTranslation): the one place that listens to sdk.i18n.
 * A page or a contribution creates one for its root and asks it for text;
 * it never subscribes itself. When the Core changes language the helper
 * draws every text it knows of again, in place: the elements stay, and with
 * them what the user typed and what the page holds. No unmount, no mount.
 *
 *   const texts = createPluginTranslation(sdk.i18n, root);
 *   texts.t('todo.add')                              the text of the moment
 *   texts.text(button, 'todo.add')                   an element's text, kept up to date
 *   texts.attr(input, 'placeholder', 'todo.new-todo-placeholder')
 *   texts.plain(box, error.message)                         data, shown as it is
 *   texts.onChange(drawWho)                                 text composed with data
 *   texts.stop()                                            in the teardown
 *
 * Markup names its text the same way, and is drawn when the helper is made:
 *
 *   <h1 data-i18n="todo.title"></h1>
 *   <input data-i18n-placeholder="todo.new-todo-placeholder">
 *
 * The plugin holds no words: a key the application has no text for is shown
 * as the key, which is what the Core shows for one of its own.
 */

const I18N_METHODS = ['translate', 'subscribe'];

/** The attributes markup may name a key for; a change of language reaches these. */
const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];

const TEXT_KEY = 'data-i18n';
const attrKey = (name) => `${TEXT_KEY}-${name}`;

/** What an SDK lacks of sdk.i18n, as 'sdk.i18n.translate', ...: [] when nothing. */
export function missingI18n(sdk) {
  return I18N_METHODS.filter((m) => typeof sdk?.i18n?.[m] !== 'function').map((m) => `sdk.i18n.${m}`);
}

/**
 * @param {{ translate(key: string): string, subscribe(listener: () => void): () => void }} i18n sdk.i18n
 * @param {ShadowRoot | Element} root Where the text is; only what is inside it is drawn again.
 */
export function createPluginTranslation(i18n, root) {
  const composed = new Set();
  let stopped = false;

  const t = (key) => i18n.translate(key);

  // Every text is set as text, never as markup: a translation is data.
  const drawText = (el) => { el.textContent = t(el.getAttribute(TEXT_KEY)); };
  const drawAttr = (el, name) => { el.setAttribute(name, t(el.getAttribute(attrKey(name)))); };

  /** Every text inside the root, in the language of the moment. */
  function draw() {
    for (const el of root.querySelectorAll(`[${TEXT_KEY}]`)) drawText(el);
    for (const name of ATTRIBUTES) {
      for (const el of root.querySelectorAll(`[${attrKey(name)}]`)) drawAttr(el, name);
    }
    for (const redraw of [...composed]) redraw();
  }

  draw();

  // The Core drops a mount's listeners when the mount is gone; this stops on
  // its own before that, and ignores a late call either way.
  const unsubscribe = i18n.subscribe(() => {
    if (!stopped) draw();
  });

  return {
    t,

    /** Give `el` the text for `key`, now and after every change of language. */
    text(el, key) {
      el.setAttribute(TEXT_KEY, key);
      drawText(el);
      return el;
    },

    /** The same for an attribute: placeholder, title or aria-label. */
    attr(el, name, key) {
      if (!ATTRIBUTES.includes(name)) {
        throw new Error(`todo-plugin: a change of language would not reach "${name}"; use one of ${ATTRIBUTES.join(', ')}`);
      }
      el.setAttribute(attrKey(name), key);
      drawAttr(el, name);
      return el;
    },

    /** Show data in `el` as it is - an error the API worded, a name - and stop translating it. */
    plain(el, value) {
      el.removeAttribute(TEXT_KEY);
      el.textContent = value;
      return el;
    },

    /** Run `redraw` after every change of language: for text composed with data. */
    onChange(redraw) {
      composed.add(redraw);
    },

    /** Stop listening. Safe to call more than once. */
    stop() {
      if (stopped) return;
      stopped = true;
      composed.clear();
      unsubscribe();
    },
  };
}
