// No words of the plugin's own reach the screen: every text it shows is
// what sdk.i18n answered for a key, or data.
//
// Every surface is drawn with translations that answer each key as a mark,
// ⟦en:key⟧, and every state it can be in is read back: text, placeholders,
// tooltips and accessible names. Whatever is left once the marks and the
// data (what the API answered, what the test typed) are taken out must hold
// no letters - a word in the source would still be there. Each key behind a
// mark must be in the plugin's key inventory.
//
// This reads what a person can read on the plugin's surfaces. It does not
// judge string literals in general: paths, class names, ids and the like
// never reach it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInventory } from '../translations/inventory.js';
import * as actionModule from './extensions/computer-todo-action.js';
import * as tabModule from './extensions/computer-todo-tab.js';
import { mount, unmount } from './todo-app.js';
import { MARK, fakeI18n } from './testing/i18n.js';
import { fakeSdk, settle } from './testing/sdk.js';

const KEYS = new Set(readInventory());

const TEXT_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'label'];

/** Everything a person could read in a root: [where, text]. */
function readable(root) {
  const found = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) found.push([`text in <${node.parentElement?.localName}>`, node.textContent]);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.localName === 'style' || node.localName === 'script') return;
      for (const name of TEXT_ATTRIBUTES) {
        if (node.hasAttribute(name)) found.push([`${name} of <${node.localName}>`, node.getAttribute(name)]);
      }
      if (node.localName === 'input' && ['submit', 'button', 'reset'].includes(node.type) && node.hasAttribute('value')) {
        found.push([`value of <input type=${node.type}>`, node.getAttribute('value')]);
      }
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return found;
}

/** The words that are not the plugin's: what the API answered with, and what the test typed. */
const DATA = ['alice', 'Replace the disk', 'Buy milk', 'New Employee Setup', 'Create account', 'Assign laptop', 'Offboarding', 'Server said no'];

/** Fails on any letter a surface shows that is neither a marked key nor data. */
function expectOnlyKeysAndData(root) {
  const read = readable(root);
  for (const [where, text] of read) {
    let rest = text.replace(MARK, '');
    for (const datum of DATA) rest = rest.split(datum).join('');
    expect(rest, `${where} shows words that did not come from sdk.i18n: ${JSON.stringify(text)}`).not.toMatch(/\p{L}/u);
    for (const [, key] of text.matchAll(MARK)) {
      expect(KEYS.has(key), `${where}: key "${key}" is not in the key inventory`).toBe(true);
    }
  }
  return read;
}

const TODOS = [
  { id: 2, title: 'Replace the disk', computer_id: 42 },
  { id: 1, title: 'Buy milk' },
];
const LISTS = [{ id: 7, name: 'New Employee Setup', items: ['Create account', 'Assign laptop'] }];

let host;
let i18n;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  i18n = fakeI18n();
});

afterEach(() => {
  // Whatever a surface asked sdk.i18n for was a key of the inventory, never data.
  for (const [key] of i18n.translate.mock.calls) {
    expect(KEYS.has(key), `sdk.i18n.translate was asked for "${key}", which is not in the key inventory`).toBe(true);
  }
  document.body.replaceChildren();
});

const $ = (selector) => host.shadowRoot.querySelector(selector);
const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true }));
const failing = (sdk) => sdk.api.get.mockImplementation(async (path) => {
  if (path === '/me') return { username: 'alice', can_write: true };
  throw new Error('Server said no');
});

describe('the To do List page', () => {
  it('before the API has answered', () => {
    mount(host, { sdk: fakeSdk({ i18n, todos: TODOS }), path: '' });
    expect(expectOnlyKeysAndData(host.shadowRoot).length).toBeGreaterThan(0);
    unmount(host);
  });

  it('with todos, one about a computer, one being edited', async () => {
    mount(host, { sdk: fakeSdk({ i18n, todos: TODOS }), path: '' });
    await settle();
    expect($('li .tag')).not.toBeNull();
    expectOnlyKeysAndData(host.shadowRoot);

    $('li button[data-i18n="todo.edit"]').click();
    await settle();
    expect($('li input[type=text]')).not.toBeNull();
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });

  it('empty, for a read-only user', async () => {
    mount(host, { sdk: fakeSdk({ i18n, canWrite: false }), path: '' });
    await settle();
    expect($('.empty')).not.toBeNull();
    expect($('.who').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });

  it('with an error the API answered', async () => {
    const sdk = fakeSdk({ i18n, todos: TODOS });
    failing(sdk);
    mount(host, { sdk, path: '' });
    await settle();
    expect($('.error').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });

  it('after a change of language', async () => {
    mount(host, { sdk: fakeSdk({ i18n, todos: TODOS }), path: '' });
    await settle();
    i18n.change('pt');
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });
});

describe('the Predefined to do lists page', () => {
  it('before the API has answered', () => {
    mount(host, { sdk: fakeSdk({ i18n, lists: LISTS }), path: '/predefined' });
    expect(expectOnlyKeysAndData(host.shadowRoot).length).toBeGreaterThan(0);
    unmount(host);
  });

  it('with lists, one being edited', async () => {
    mount(host, { sdk: fakeSdk({ i18n, lists: LISTS }), path: '/predefined' });
    await settle();
    expectOnlyKeysAndData(host.shadowRoot);

    $('.head button[data-i18n="todo.edit"]').click();
    await settle();
    expect($('.edit-name')).not.toBeNull();
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });

  it('empty, for a read-only user', async () => {
    mount(host, { sdk: fakeSdk({ i18n, canWrite: false }), path: '/predefined' });
    await settle();
    expect($('.empty')).not.toBeNull();
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });

  it('with a new list that has no items', async () => {
    mount(host, { sdk: fakeSdk({ i18n }), path: '/predefined' });
    await settle();
    $('.new-name').value = 'Offboarding';
    submit($('.template-form'));
    expect($('.error').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });

  it('with a list being edited that was given no name, then no items', async () => {
    mount(host, { sdk: fakeSdk({ i18n, lists: LISTS }), path: '/predefined' });
    await settle();
    $('.head button[data-i18n="todo.edit"]').click();
    await settle();

    $('.edit-name').value = '';
    $('.actions button[data-i18n="todo.save"]').click();
    expect($('.error').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);

    $('.edit-name').value = 'Offboarding';
    $('.edit-items').value = '';
    $('.actions button[data-i18n="todo.save"]').click();
    expect($('.error').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });

  it('with an error the API answered', async () => {
    const sdk = fakeSdk({ i18n, lists: LISTS });
    failing(sdk);
    mount(host, { sdk, path: '/predefined' });
    await settle();
    expect($('.error').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    unmount(host);
  });
});

describe('the To do tab on Computer Details', () => {
  it('before the API has answered, then with todos, one being edited', async () => {
    const handle = tabModule.mount(host, { computerId: 42 }, fakeSdk({ i18n, todos: TODOS }));
    expect(expectOnlyKeysAndData(host.shadowRoot).length).toBeGreaterThan(0);
    await settle();
    expectOnlyKeysAndData(host.shadowRoot);

    $('li button[data-i18n="todo.edit"]').click();
    await settle();
    expectOnlyKeysAndData(host.shadowRoot);
    handle.unmount();
  });

  it('empty, for a read-only user', async () => {
    const handle = tabModule.mount(host, { computerId: 43 }, fakeSdk({ i18n, canWrite: false }));
    await settle();
    expect($('.empty')).not.toBeNull();
    expect($('.who').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    handle.unmount();
  });

  it('with an error the API answered', async () => {
    const sdk = fakeSdk({ i18n, todos: TODOS });
    failing(sdk);
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();
    expect($('.error').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    handle.unmount();
  });

  it('without a computer', () => {
    const handle = tabModule.mount(host, {}, fakeSdk({ i18n }));
    expect(expectOnlyKeysAndData(host.shadowRoot).length).toBe(1);
    handle.unmount();
  });
});

describe('the Add Todo action on Computer Details', () => {
  it('closed, with its dialog open, and with an error the API answered', async () => {
    const sdk = fakeSdk({ i18n });
    sdk.api.post.mockRejectedValueOnce(new Error('Server said no'));
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);
    expectOnlyKeysAndData(host.shadowRoot);

    $('.open').click();
    expect($('dialog').open).toBe(true);
    expectOnlyKeysAndData(host.shadowRoot);

    $('.new-title').value = 'Replace the disk';
    submit($('form'));
    await settle();
    expect($('.error').hidden).toBe(false);
    expectOnlyKeysAndData(host.shadowRoot);
    handle.unmount();
  });

  it('tells the Core in words that came from a key, and nothing else', async () => {
    const sdk = fakeSdk({ i18n });
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);
    $('.open').click();
    $('.new-title').value = 'Replace the disk';
    submit($('form'));
    await settle();

    expect(sdk.notify).toHaveBeenCalledTimes(1);
    const { message } = sdk.notify.mock.calls[0][0];
    const [mark, key] = [...message.matchAll(MARK)][0];
    expect(message).toBe(mark);
    expect(KEYS.has(key)).toBe(true);
    handle.unmount();
  });
});

describe('the standalone page', () => {
  it('holds keys where it would hold words: its title and its links', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const page = new DOMParser().parseFromString(readFileSync(join(here, '..', 'index.html'), 'utf8'), 'text/html');

    for (const [where, text] of [...readable(page.head), ...readable(page.body)]) {
      expect(KEYS.has(text.trim()), `${where} of index.html: ${JSON.stringify(text)} is not a key of the inventory`).toBe(true);
    }
    const named = [...page.querySelectorAll('[data-i18n]')].map((el) => el.getAttribute('data-i18n'));
    expect(named.length).toBeGreaterThan(0);
    for (const key of named) expect(KEYS.has(key), key).toBe(true);
  });
});
