// The Settings sections against the Core's contract:
// mount(el, {}, sdk) -> { update(context), unmount() }, rendering only inside
// `el` and talking only through the SDK. Settings is about no record, so the
// context the Core hands over is empty.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as userModule from './todo-user-settings.js';
import * as systemModule from './todo-system-settings.js';
import { en } from '../testing/i18n.js';
import { fakeSdk, settle } from '../testing/sdk.js';

let host;

beforeEach(() => {
  const outside = document.createElement('div');
  outside.textContent = 'Core';
  host = document.createElement('div');
  document.body.append(outside, host);
});

afterEach(() => {
  document.body.replaceChildren();
});

const $ = (selector) => host.shadowRoot.querySelector(selector);

describe.each([
  ['TodoUserSettings', userModule],
  ['TodoSystemSettings', systemModule],
])('%s honours the contribution contract', (name, module) => {
  it('exports mount, which returns { update, unmount }', () => {
    const handle = module.mount(host, {}, fakeSdk());
    expect(typeof handle.update).toBe('function');
    expect(typeof handle.unmount).toBe('function');
    handle.unmount();
  });

  it('renders only inside the host element', async () => {
    const before = document.body.innerHTML;
    const handle = module.mount(host, {}, fakeSdk());
    await settle();
    expect(host.shadowRoot.childNodes.length).toBeGreaterThan(0);
    expect(document.body.innerHTML).toBe(before);
    handle.unmount();
  });

  it('leaves the host empty on unmount, and unmount is safe to repeat', async () => {
    const handle = module.mount(host, {}, fakeSdk());
    await settle();
    handle.unmount();
    handle.unmount();
    expect(host.shadowRoot.childNodes.length).toBe(0);
  });

  it('draws nothing again for the same empty context, and nothing after unmount', async () => {
    const sdk = fakeSdk();
    const handle = module.mount(host, {}, sdk);
    await settle();
    const calls = sdk.api.get.mock.calls.length;
    handle.update({});
    await settle();
    expect(sdk.api.get.mock.calls.length).toBe(calls);

    handle.unmount();
    handle.update({});
    await settle();
    expect(host.shadowRoot.childNodes.length).toBe(0);
  });

  it('refuses a mount without a host element or an SDK', () => {
    expect(() => module.mount(null, {}, fakeSdk())).toThrow(/host element/);
    expect(() => module.mount(host, {}, {})).toThrow(/sdk\.api/);
  });

  it('draws nothing into a host that went away before the API answered', async () => {
    const handle = module.mount(host, {}, fakeSdk());
    handle.unmount();
    await settle();
    expect(host.shadowRoot.childNodes.length).toBe(0);
  });
});

describe('TodoUserSettings', () => {
  it('says who is calling and how many of their todos are open', async () => {
    const sdk = fakeSdk({ todos: [{ id: 1, title: 'a' }, { id: 2, title: 'b', done: true }, { id: 3, title: 'c' }] });
    const handle = userModule.mount(host, {}, sdk);
    expect($('.summary').hidden).toBe(true);
    await settle();

    expect(sdk.api.get).toHaveBeenCalledWith('/todos');
    expect($('.who').textContent).toBe(`${en('todo.signed-in-as')} alice`);
    expect($('.summary').hidden).toBe(false);
    expect($('.count').textContent).toBe('2');
    expect($('.error').hidden).toBe(true);
    handle.unmount();
  });

  it('shows the request error when the todos cannot be read', async () => {
    const sdk = fakeSdk();
    sdk.api.get.mockImplementation(async (path) => {
      if (path === '/me') throw new Error('no');
      throw new Error('Server said no');
    });
    const handle = userModule.mount(host, {}, sdk);
    await settle();
    expect($('.error').hidden).toBe(false);
    expect($('.summary').hidden).toBe(true);
    expect($('.who').hidden).toBe(true);
    handle.unmount();
  });
});

describe('TodoSystemSettings', () => {
  it('shows the service status GET /health answered, as data', async () => {
    const sdk = fakeSdk();
    const handle = systemModule.mount(host, {}, sdk);
    expect($('.summary').hidden).toBe(true);
    await settle();

    expect(sdk.api.get).toHaveBeenCalledWith('/health');
    expect($('.summary').hidden).toBe(false);
    expect($('.status').textContent).toBe('ok');
    expect($('.error').hidden).toBe(true);
    handle.unmount();
  });

  it('says the service is unavailable when GET /health fails', async () => {
    const sdk = fakeSdk();
    sdk.api.get.mockRejectedValue(new Error('down'));
    const handle = systemModule.mount(host, {}, sdk);
    await settle();
    expect($('.error').hidden).toBe(false);
    expect($('.summary').hidden).toBe(true);
    handle.unmount();
  });
});
