// sdk.ui: where the host gives one, an empty list and an unknown page are the
// Core's to draw. The plugin hands over an element and the text of the
// moment, and erases the drawing when it is gone. Where there is none, the
// plugin's own line of text stands in (the other test files, whose SDK has no
// ui, show that).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as tabModule from './extensions/computer-todo-tab.js';
import { mount, unmount } from './todo-app.js';
import { en, pt } from './testing/i18n.js';
import { fakeSdk, settle } from './testing/sdk.js';

/** sdk.ui as the Core hands it over; each drawing's erase is recorded. */
function fakeUi() {
  const erases = [];
  const drawing = () => {
    const erase = vi.fn();
    erases.push(erase);
    return erase;
  };
  return { erases, noData: vi.fn(drawing), notFound: vi.fn(drawing) };
}

const withUi = (options) => {
  const ui = fakeUi();
  return { ui, sdk: { ...fakeSdk(options), ui } };
};

let host;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  document.body.replaceChildren();
});

const $ = (selector) => host.shadowRoot.querySelector(selector);

describe('an empty list', () => {
  it('is the Core’s empty state, titled in the language of the moment', async () => {
    const { ui, sdk } = withUi();
    mount(host, { sdk, path: '' });
    await settle();

    expect(ui.noData).toHaveBeenCalledTimes(1);
    const [slot, options] = ui.noData.mock.calls[0];
    expect(options).toEqual({ title: en('todo.no-todos'), compact: true });
    expect($('.list').contains(slot)).toBe(true);
    expect($('.empty')).toBeNull();

    sdk.i18n.change('pt');

    expect(ui.noData).toHaveBeenCalledTimes(2);
    expect(ui.noData.mock.calls[1]).toEqual([slot, { title: pt('todo.no-todos'), compact: true }]);
    unmount(host);
  });

  it('is erased when a todo arrives, and drawn again for nothing new when the language changes', async () => {
    const { ui, sdk } = withUi();
    mount(host, { sdk, path: '' });
    await settle();

    $('.new-title').value = 'Call IT';
    $('.add-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(ui.erases[0]).toHaveBeenCalled();
    expect($('li .title').textContent).toBe('Call IT');

    sdk.i18n.change('pt');
    expect(ui.noData).toHaveBeenCalledTimes(1);
    unmount(host);
  });

  it('is erased when the page is unmounted', async () => {
    const { ui, sdk } = withUi();
    mount(host, { sdk, path: '' });
    await settle();

    unmount(host);
    expect(ui.erases[0]).toHaveBeenCalled();
  });

  it('on the predefined lists page, says there are no lists', async () => {
    const { ui, sdk } = withUi();
    mount(host, { sdk, path: '/predefined' });
    await settle();

    expect(ui.noData).toHaveBeenCalledWith(expect.any(HTMLElement), {
      title: en('todo.no-predefined-lists'),
      compact: true,
    });
    unmount(host);
  });

  it('on the Computer Details tab, says the computer has no todos', async () => {
    const { ui, sdk } = withUi();
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();

    expect(ui.noData).toHaveBeenCalledWith(expect.any(HTMLElement), {
      title: en('todo.no-computer-todos'),
      compact: true,
    });
    handle.unmount();
    expect(ui.erases[0]).toHaveBeenCalled();
  });
});

describe('a sub-path with no page', () => {
  it('is the Core’s page not found, erased on unmount', async () => {
    const { ui, sdk } = withUi();
    mount(host, { sdk, path: '/no-such-page' });
    await settle();

    expect(ui.notFound).toHaveBeenCalledTimes(1);
    expect(host.shadowRoot.contains(ui.notFound.mock.calls[0][0])).toBe(true);
    expect($('.list')).toBeNull();
    expect(sdk.api.get).not.toHaveBeenCalled();

    unmount(host);
    expect(ui.erases[0]).toHaveBeenCalled();
  });

  it('is the To do List where the host gives no sdk.ui', async () => {
    const sdk = fakeSdk();
    mount(host, { sdk, path: '/no-such-page' });
    await settle();

    expect($('.list')).not.toBeNull();
    expect($('.empty').textContent).toBe(en('todo.no-todos'));
    unmount(host);
  });
});
