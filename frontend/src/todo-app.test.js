// The standalone page is unchanged by the Computer Details contributions:
// still every todo, still added without a computer.

import { expect, it, vi } from 'vitest';
import { en, fakeI18n } from './testing/i18n.js';
import { mount } from './todo-app.js';

it('lists every todo, saying which computer one is about', async () => {
  const api = {
    get: vi.fn(async (path) => (path === '/me' ? { username: 'alice', can_write: true } : { total: 2, results: [
      { id: 2, title: 'Replace the disk', done: false, computer_id: 42 },
      { id: 1, title: 'Buy milk', done: false, computer_id: null },
    ] })),
    post: vi.fn(async (path, body) => ({ id: 3, done: false, computer_id: null, ...body })),
    put: vi.fn(),
    delete: vi.fn(),
  };
  const el = document.createElement('div');
  document.body.append(el);

  const unmount = mount(el, { sdk: { api, i18n: fakeI18n() }, path: '' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(api.get).toHaveBeenCalledWith('/todos?limit=200&offset=0'); // no ui.pager: one request, no footer
  expect([...el.shadowRoot.querySelectorAll('li .tag')].map((n) => n.textContent)).toEqual([`${en('todo.computer')} 42`]);

  el.shadowRoot.querySelector('.new-title').value = 'Call IT';
  el.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(api.post).toHaveBeenCalledWith('/todos', { title: 'Call IT' });

  unmount();
  el.remove();
});

// The Core's own pager, loader and download button, through sdk.ui.

import { settle, fakeSdk } from './testing/sdk.js';

const manyTodos = (n) => Array.from({ length: n }, (_, i) => ({ id: n - i, title: `todo ${n - i}` }));
const shown = (el) => [...el.shadowRoot.querySelectorAll('li .title')].map((node) => node.textContent);

async function standalone(sdk) {
  const el = document.createElement('div');
  document.body.append(el);
  const unmount = mount(el, { sdk, path: '' });
  await settle();
  return { el, unmount };
}

it('shows the first page and tells the pager what it holds', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const { el, unmount } = await standalone(sdk);

  expect(sdk.api.get).toHaveBeenCalledWith('/todos?limit=10&offset=0');
  expect(shown(el)).toHaveLength(10);
  expect(sdk.pager.options.pageSize).toBe(10);
  expect(sdk.pager.update).toHaveBeenLastCalledWith({ total: 25, loaded: 10, loading: false });
  unmount();
});

it('replaces the rows when the pager asks for another page', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const { el, unmount } = await standalone(sdk);

  sdk.pager.options.onChange({ offset: 20, limit: 10, append: false });
  await settle();

  expect(shown(el)).toEqual(['todo 5', 'todo 4', 'todo 3', 'todo 2', 'todo 1']);
  unmount();
});

it('adds to the rows when the pager asks to load more', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const { el, unmount } = await standalone(sdk);

  sdk.pager.options.onChange({ offset: 10, limit: 10, append: true });
  await settle();

  expect(shown(el)).toHaveLength(20);
  expect(sdk.pager.update).toHaveBeenLastCalledWith({ total: 25, loaded: 20, loading: false });
  unmount();
});

it('steps back a page when a delete empties the last one', async () => {
  const sdk = fakeSdk({ todos: manyTodos(11) });
  const { el, unmount } = await standalone(sdk);
  sdk.pager.options.onChange({ offset: 10, limit: 10, append: false });
  await settle();
  expect(shown(el)).toEqual(['todo 1']);

  [...el.shadowRoot.querySelectorAll('li button')].find((b) => b.textContent.includes('todo.delete')).click();
  await settle();

  expect(shown(el)).toHaveLength(10);
  expect(sdk.pager.update).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
  unmount();
});

it('draws the Core loader while the first page loads, and erases it', async () => {
  const sdk = fakeSdk({ todos: manyTodos(3) });
  const erase = vi.fn();
  sdk.ui.loading.mockReturnValue(erase);
  const { unmount } = await standalone(sdk);

  expect(sdk.ui.loading).toHaveBeenCalledTimes(1);
  expect(erase).toHaveBeenCalledTimes(1);
  unmount();
});

it('offers the Core download button on the standalone page only', async () => {
  const sdk = fakeSdk({ todos: manyTodos(3) });
  const { unmount } = await standalone(sdk);
  expect(sdk.ui.exportButton).toHaveBeenCalledWith(expect.any(HTMLElement), { path: '/api/exports/todos' });
  unmount();

  const scoped = fakeSdk({ todos: manyTodos(3) });
  const el = document.createElement('div');
  document.body.append(el);
  const { mountTodoList } = await import('./pages/todo-list.js');
  const root = el.attachShadow({ mode: 'open' });
  const stop = mountTodoList(root, { api: scoped.api, i18n: scoped.i18n, ui: scoped.ui, computerId: 7 });
  await settle();
  expect(scoped.ui.exportButton).not.toHaveBeenCalled();
  stop();
});

it('erases what the Core drew when the page goes', async () => {
  const sdk = fakeSdk({ todos: manyTodos(3) });
  const stopExport = vi.fn();
  sdk.ui.exportButton.mockReturnValue(stopExport);
  const { unmount } = await standalone(sdk);

  unmount();
  expect(sdk.pager.destroy).toHaveBeenCalledTimes(1);
  expect(stopExport).toHaveBeenCalledTimes(1);
});
