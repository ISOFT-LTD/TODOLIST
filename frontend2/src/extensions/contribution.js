/**
 * The plugin side of a Core extension contribution: what each exposed
 * contribution module's `mount` is built from.
 *
 * The Core owns where a contribution sits, who may see it, loading it and its
 * lifecycle. It hands over an empty element, a context and its SDK:
 *
 *   const handle = mount(el, { computerId: 42 }, sdk);
 *   handle.update({ computerId: 43 });   // same host, new context
 *   handle.unmount();                    // host is going away
 *
 * Everything the contribution renders lives in a shadow root on `el`, so the
 * Core's CSS and the plugin's cannot leak into each other, and nothing outside
 * `el` is ever read or changed.
 *
 * This is a different contract from the standalone page's (todo-app.js:
 * mount(el, { sdk, path }) returning an unmount function), which is left as
 * it is.
 *
 * SDK contract relied on (the Core's SDK v1):
 *   sdk.api.get / post / put / delete   this plugin's API, through the Core
 *   sdk.i18n.translate / subscribe      the application's translations
 *   sdk.notify({ type, message })       optional: a toast the way the Core shows its own
 *
 * A change of language is no update(): the renderer's words come from
 * sdk.i18n through the plugin's translation helper, which redraws them in
 * place and keeps what the renderer holds.
 */

import { missingI18n } from '../plugin-translation.js';

const API_METHODS = ['get', 'post', 'put', 'delete'];

/** The computer a Computer Details context names, or null when it names none. */
export function computerIdOf(context) {
  const id = context?.computerId;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Tell the user something through the Core, when the SDK can. */
export function notify(sdk, type, message) {
  if (typeof sdk?.notify !== 'function') return;
  try {
    sdk.notify({ type, message });
  } catch (error) {
    console.error('todo-plugin: sdk.notify() failed', error);
  }
}

/**
 * Build a contribution's mount() from a renderer.
 *
 * `render(root, { computerId, sdk })` draws into a shadow root that holds only
 * `styles`, and returns its teardown. It is called again - after the previous
 * teardown - whenever update() brings a different computer, so a renderer
 * never has to handle a context change itself.
 *
 * @param {object} options
 * @param {string} options.name Used in error messages.
 * @param {string} options.styles CSS for the shadow root.
 * @param {(root: ShadowRoot, props: { computerId: number|null, sdk: object }) => () => void} options.render
 */
export function createContribution({ name, styles, render }) {
  return function mount(el, context, sdk) {
    if (!(el instanceof HTMLElement)) {
      throw new Error(`todo-plugin ${name}: mount() needs a host element`);
    }
    const missing = [
      ...API_METHODS.filter((m) => typeof sdk?.api?.[m] !== 'function').map((m) => `sdk.api.${m}`),
      ...missingI18n(sdk),
    ];
    if (missing.length) {
      throw new Error(`todo-plugin ${name}: mount() needs an SDK with ${missing.join(', ')}`);
    }

    // attachShadow() can only run once per element, so reuse it if the host
    // is handed over again.
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });

    let computerId = computerIdOf(context);
    let teardown = null;
    let unmounted = false;

    function clear() {
      const done = teardown;
      teardown = null;
      try {
        done?.();
      } finally {
        root.replaceChildren();
      }
    }

    function draw() {
      clear();
      const style = document.createElement('style');
      style.textContent = styles;
      root.append(style);
      teardown = render(root, { computerId, sdk });
    }

    draw();

    return {
      update(next) {
        if (unmounted) return;
        const nextId = computerIdOf(next);
        // The same computer in a new object is not a change.
        if (nextId === computerId) return;
        computerId = nextId;
        draw();
      },
      unmount() {
        if (unmounted) return;
        unmounted = true;
        clear();
      },
    };
  };
}
