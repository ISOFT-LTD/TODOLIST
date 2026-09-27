// The Computer Details contributions against the Core's contract:
// mount(el, { computerId }, sdk) -> { update(context), unmount() }, rendering
// only inside `el` and talking only through the SDK.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as actionModule from './computer-todo-action.js';
import * as tabModule from './computer-todo-tab.js';

/** The Core's SDK v1 over an in-memory todo API. */
function fakeSdk({ canWrite = true } = {}) {
  const todos = [];
  let nextId = 1;
  const api = {
    get: vi.fn(async (path) => {
      if (path === '/me') return { username: 'alice', can_write: canWrite };
      const url = new URL(path, 'http://api.invalid');
      const computer = url.searchParams.get('computer_id');
      return todos
        .filter((t) => computer === null || t.computer_id === Number(computer))
        .slice()
        .reverse();
    }),
    post: vi.fn(async (path, body) => {
      const todo = { id: nextId++, title: body.title, done: false, computer_id: body.computer_id ?? null };
      todos.push(todo);
      return todo;
    }),
    put: vi.fn(async (path, body) => {
      const todo = todos.find((t) => `/todos/${t.id}` === path);
      Object.assign(todo, body);
      return todo;
    }),
    delete: vi.fn(async () => null),
  };
  return { api, navigate: vi.fn(), notify: vi.fn(), todos };
}

/** Let pending API promises and their renders settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const titles = (el) => [...el.shadowRoot.querySelectorAll('li .title')].map((n) => n.textContent);

let host;
let outside;

beforeEach(() => {
  outside = document.createElement('div');
  outside.id = 'core-owned';
  outside.textContent = 'Core';
  host = document.createElement('div');
  document.body.append(outside, host);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe.each([
  ['ComputerTodoAction', actionModule],
  ['ComputerTodoTab', tabModule],
])('%s honours the contribution contract', (name, module) => {
  it('exports mount, which returns { update, unmount }', () => {
    expect(typeof module.mount).toBe('function');
    const handle = module.mount(host, { computerId: 42 }, fakeSdk());
    expect(typeof handle.update).toBe('function');
    expect(typeof handle.unmount).toBe('function');
    handle.unmount();
  });

  it('renders only inside the host element', async () => {
    const before = document.body.innerHTML;
    const handle = module.mount(host, { computerId: 42 }, fakeSdk());
    await settle();

    expect(host.shadowRoot.childNodes.length).toBeGreaterThan(0);
    // The light DOM of the page, the host included, is untouched.
    expect(document.body.innerHTML).toBe(before);
    handle.unmount();
  });

  it('leaves the host empty on unmount, and unmount is safe to repeat', async () => {
    const handle = module.mount(host, { computerId: 42 }, fakeSdk());
    await settle();

    handle.unmount();
    handle.unmount();
    expect(host.shadowRoot.childNodes.length).toBe(0);
    expect(host.childNodes.length).toBe(0);
  });

  it('ignores update after unmount', async () => {
    const handle = module.mount(host, { computerId: 42 }, fakeSdk());
    handle.unmount();
    handle.update({ computerId: 43 });
    await settle();
    expect(host.shadowRoot.childNodes.length).toBe(0);
  });

  it('can mount again on the same host', async () => {
    module.mount(host, { computerId: 42 }, fakeSdk()).unmount();
    const handle = module.mount(host, { computerId: 42 }, fakeSdk());
    await settle();
    expect(host.shadowRoot.childNodes.length).toBeGreaterThan(0);
    handle.unmount();
  });

  it('refuses a mount without a host element or an SDK', () => {
    expect(() => module.mount(null, { computerId: 42 }, fakeSdk())).toThrow(/host element/);
    expect(() => module.mount(host, { computerId: 42 }, {})).toThrow(/sdk\.api/);
  });
});

describe('ComputerTodoTab', () => {
  it("lists only this computer's todos", async () => {
    const sdk = fakeSdk();
    sdk.todos.push(
      { id: 1, title: 'Replace the disk', done: false, computer_id: 42 },
      { id: 2, title: 'Reimage', done: false, computer_id: 7 },
      { id: 3, title: 'Buy milk', done: false, computer_id: null },
    );
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();

    expect(sdk.api.get).toHaveBeenCalledWith('/todos?computer_id=42');
    expect(titles(host)).toEqual(['Replace the disk']);
    handle.unmount();
  });

  it('adds a todo to this computer', async () => {
    const sdk = fakeSdk();
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();

    host.shadowRoot.querySelector('.new-title').value = 'Check the fan';
    host.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(sdk.api.post).toHaveBeenCalledWith('/todos', { title: 'Check the fan', computer_id: 42 });
    expect(titles(host)).toEqual(['Check the fan']);
    handle.unmount();
  });

  it('completes a todo through the existing update', async () => {
    const sdk = fakeSdk();
    sdk.todos.push({ id: 1, title: 'Replace the disk', done: false, computer_id: 42 });
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();

    const check = host.shadowRoot.querySelector('li input[type=checkbox]');
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    await settle();

    expect(sdk.api.put).toHaveBeenCalledWith('/todos/1', { done: true });
    expect(host.shadowRoot.querySelector('li').classList.contains('done')).toBe(true);
    handle.unmount();
  });

  it('shows another computer on update, and nothing new for the same one', async () => {
    const sdk = fakeSdk();
    sdk.todos.push(
      { id: 1, title: 'On 42', done: false, computer_id: 42 },
      { id: 2, title: 'On 43', done: false, computer_id: 43 },
    );
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();

    handle.update({ computerId: 42 });
    await settle();
    expect(sdk.api.get.mock.calls.filter(([p]) => p.startsWith('/todos'))).toHaveLength(1);

    handle.update({ computerId: 43 });
    await settle();
    expect(titles(host)).toEqual(['On 43']);
    handle.unmount();
  });

  it('hides the add form from a read-only user', async () => {
    const handle = tabModule.mount(host, { computerId: 42 }, fakeSdk({ canWrite: false }));
    await settle();
    expect(host.shadowRoot.querySelector('.add-form').hidden).toBe(true);
    handle.unmount();
  });
});

describe('ComputerTodoAction', () => {
  function addFromDialog(title) {
    host.shadowRoot.querySelector('.open').click();
    host.shadowRoot.querySelector('.new-title').value = title;
    host.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    return settle();
  }

  it('is one compact button until clicked', () => {
    const handle = actionModule.mount(host, { computerId: 42 }, fakeSdk());
    const button = host.shadowRoot.querySelector('.open');
    expect(button.textContent.trim()).toBe('Add Todo');
    expect(host.shadowRoot.querySelector('dialog').open).toBe(false);
    handle.unmount();
  });

  it('adds a todo for this computer and tells the Core', async () => {
    const sdk = fakeSdk();
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);

    await addFromDialog('Replace the disk');

    expect(sdk.api.post).toHaveBeenCalledWith('/todos', { title: 'Replace the disk', computer_id: 42 });
    expect(sdk.notify).toHaveBeenCalledWith({ type: 'success', message: 'Todo added for this computer.' });
    expect(host.shadowRoot.querySelector('dialog').open).toBe(false);
    handle.unmount();
  });

  it('adds to the new computer after update', async () => {
    const sdk = fakeSdk();
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);
    handle.update({ computerId: 43 });

    await addFromDialog('Reimage');

    expect(sdk.api.post).toHaveBeenCalledWith('/todos', { title: 'Reimage', computer_id: 43 });
    handle.unmount();
  });

  it('shows the API error in the dialog and keeps it open', async () => {
    const sdk = fakeSdk();
    sdk.api.post.mockRejectedValueOnce(new Error('You can view this list but not change it.'));
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);

    await addFromDialog('Replace the disk');

    const error = host.shadowRoot.querySelector('.error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('You can view this list but not change it.');
    expect(host.shadowRoot.querySelector('dialog').open).toBe(true);
    expect(sdk.notify).not.toHaveBeenCalled();
    handle.unmount();
  });

  it('renders nothing without a computer', () => {
    const handle = actionModule.mount(host, { computerId: Number.NaN }, fakeSdk());
    expect(host.shadowRoot.querySelector('.open')).toBeNull();
    handle.unmount();
  });

  it('closes an open dialog on unmount', () => {
    const handle = actionModule.mount(host, { computerId: 42 }, fakeSdk());
    host.shadowRoot.querySelector('.open').click();
    const dialog = host.shadowRoot.querySelector('dialog');
    expect(dialog.open).toBe(true);

    handle.unmount();
    expect(dialog.open).toBe(false);
  });
});

describe('the action and the tab together', () => {
  it('a todo added from the header appears in the open tab', async () => {
    const sdk = fakeSdk();
    const tabHost = document.createElement('div');
    document.body.append(tabHost);
    const tab = tabModule.mount(tabHost, { computerId: 42 }, sdk);
    const action = actionModule.mount(host, { computerId: 42 }, sdk);
    await settle();

    host.shadowRoot.querySelector('.open').click();
    host.shadowRoot.querySelector('.new-title').value = 'Replace the disk';
    host.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    await settle();

    expect(titles(tabHost)).toEqual(['Replace the disk']);
    action.unmount();
    tab.unmount();
  });

  it('an unmounted tab stops listening', async () => {
    const sdk = fakeSdk();
    const tabHost = document.createElement('div');
    document.body.append(tabHost);
    tabModule.mount(tabHost, { computerId: 42 }, sdk).unmount();
    await settle();
    const listCalls = () => sdk.api.get.mock.calls.filter(([p]) => p.startsWith('/todos')).length;
    const before = listCalls();

    const action = actionModule.mount(host, { computerId: 42 }, sdk);
    host.shadowRoot.querySelector('.open').click();
    host.shadowRoot.querySelector('.new-title').value = 'x';
    host.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(listCalls()).toBe(before);
    action.unmount();
  });
});
