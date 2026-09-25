/**
 * Todo plugin UI - exposed to the ITSM shell through Module Federation.
 *
 * Framework-agnostic on purpose: the shell calls mount() from a React effect,
 * so the plugin never bundles or shares React.
 *
 * The plugin reaches the outside world only through the SDK it is given. It
 * never imports Core code and knows nothing about URLs, sessions or transport:
 * in the ITSM shell, Core's SDK routes sdk.api through Core; standalone, the
 * page's own SDK (core-sdk.js) calls through Core relative to the page.
 *
 *   const unmount = mount(element, { sdk, path });
 *
 * One remote, one exposed module, two pages. Which page renders is decided by
 * `path`, the sub-path below the plugin's root as the shell's navigation names
 * it (manifest.json, `navigation[].children[].path`):
 *
 *   ''             or '/'    the To do List             /plugins/ui/todo
 *   '/predefined'            the Predefined to do lists /plugins/ui/todo/predefined
 *
 * When the host passes no `path`, the plugin reads it off the page URL, so a
 * shell that only routes the address bar still lands on the right page. To
 * switch pages, the host unmounts and mounts again with the new path.
 *
 * SDK contract this plugin relies on:
 *   sdk.api.get(path) / post(path, body) / put(path, body) / delete(path)
 *   - path is relative to this plugin's API, e.g. '/todos/1'
 *   - resolves to the parsed JSON response, or null when there is no body
 *   - rejects with an Error whose message is safe to show the user
 */

import styles from './styles.css?inline';
import { mountPredefinedLists } from './pages/predefined-lists.js';
import { mountTodoList } from './pages/todo-list.js';

/** The plugin's pages, keyed by sub-path. The first one is the default. */
const PAGES = [
  { path: '', mount: mountTodoList },
  { path: '/predefined', mount: mountPredefinedLists },
];

const instances = new WeakMap();

const API_METHODS = ['get', 'post', 'put', 'delete'];

/** '/predefined/', 'predefined' and '/predefined' all mean the same page. */
function normalizePath(path) {
  const trimmed = String(path ?? '').trim().replace(/\/+$/, '').replace(/^\/*/, '/');
  return trimmed === '/' ? '' : trimmed;
}

/** The sub-path the page URL ends with, when the host did not say. */
function pathFromLocation() {
  if (typeof window === 'undefined') return '';
  const here = window.location.pathname.replace(/\/+$/, '');
  const match = PAGES.find((page) => page.path && here.endsWith(page.path));
  return match ? match.path : '';
}

/** The page for a sub-path; unknown paths fall back to the To do List. */
export function resolvePage(path) {
  const wanted = path === undefined || path === null ? pathFromLocation() : normalizePath(path);
  return PAGES.find((page) => page.path === wanted) ?? PAGES[0];
}

/**
 * Render the todo plugin into `el`.
 *
 * @param {HTMLElement} el Container owned by the host.
 * @param {object} options
 * @param {object} options.sdk Host SDK. Only sdk.api is used.
 * @param {string} [options.path] Sub-path below the plugin root, e.g. '/predefined'.
 * @returns {() => void} Unmount function.
 */
export function mount(el, { sdk, path } = {}) {
  if (!(el instanceof HTMLElement)) {
    throw new Error('todo-plugin: mount() needs a container element');
  }
  const missing = API_METHODS.filter((m) => typeof sdk?.api?.[m] !== 'function');
  if (missing.length) {
    throw new Error(`todo-plugin: mount() needs { sdk } with sdk.api.${missing.join(', sdk.api.')}`);
  }
  const { api } = sdk;

  // Remount cleanly. React StrictMode mounts, unmounts, then mounts again.
  unmount(el);

  // attachShadow() can only run once per element, so reuse it on remount.
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${styles}</style>`;

  const page = resolvePage(path);
  const teardownPage = page.mount(root, { api });

  instances.set(el, () => {
    teardownPage();
    root.innerHTML = '';
  });

  return () => unmount(el);
}

/** Tear down the app rendered into `el`. Safe to call more than once. */
export function unmount(el) {
  const teardown = instances.get(el);
  if (!teardown) return;
  instances.delete(el);
  teardown();
}

export default { mount, unmount };
