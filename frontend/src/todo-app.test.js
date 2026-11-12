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

  expect(api.get).toHaveBeenCalledWith('/todos?limit=200&offset=0');
  expect([...el.shadowRoot.querySelectorAll('li .tag')].map((n) => n.textContent)).toEqual([`${en('todo.computer')} 42`]);

  el.shadowRoot.querySelector('.new-title').value = 'Call IT';
  el.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(api.post).toHaveBeenCalledWith('/todos', { title: 'Call IT' });

  unmount();
  el.remove();
});

// The Core's table mode, list footer and loader, through sdk.ui. The page keeps
// its own total and offset; the Core draws the footer from them.

import { settle, fakeSdk } from './testing/sdk.js';
import { mountTodoList } from './pages/todo-list.js';

const manyTodos = (n) => Array.from({ length: n }, (_, i) => ({ id: n - i, title: `todo ${n - i}` }));
const shown = (el) => [...el.shadowRoot.querySelectorAll('li .title')].map((node) => node.textContent);

async function standalone(sdk) {
  const el = document.createElement('div');
  document.body.append(el);
  const unmount = mount(el, { sdk, path: '' });
  await settle();
  return { el, unmount };
}

it('shows the first page and hands the Core this tables numbers', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const { el, unmount } = await standalone(sdk);

  expect(sdk.api.get).toHaveBeenCalledWith('/todos?limit=10&offset=0');
  expect(shown(el)).toHaveLength(10);
  expect(sdk.pagination.last()).toMatchObject({
    mode: 'pagination', total: 25, offset: 0, loaded: 10, pageSize: 10, loading: false,
  });
  unmount();
});

it('replaces the rows when the Core reports a page', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const { el, unmount } = await standalone(sdk);

  sdk.pagination.last().onPage(20);
  await settle();

  expect(shown(el)).toEqual(['todo 5', 'todo 4', 'todo 3', 'todo 2', 'todo 1']);
  expect(sdk.pagination.last()).toMatchObject({ offset: 20, loaded: 5 });
  unmount();
});

it('adds to the rows when the Core reports Load More', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  sdk.ui.setMode('loadMore');
  const { el, unmount } = await standalone(sdk);
  expect(sdk.pagination.last().mode).toBe('loadMore');

  sdk.pagination.last().onLoadMore();
  await settle();

  expect(shown(el)).toHaveLength(20);
  expect(sdk.pagination.last()).toMatchObject({ total: 25, loaded: 20 });
  unmount();
});

it('follows the user changing the table mode, from the first page', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const { el, unmount } = await standalone(sdk);
  sdk.pagination.last().onPage(10);
  await settle();

  sdk.ui.setMode('loadMore');
  await settle();

  expect(sdk.pagination.last()).toMatchObject({ mode: 'loadMore', offset: 0, loaded: 10 });
  expect(shown(el)[0]).toBe('todo 25');
  unmount();
});

it('steps back a page when a delete empties the last one', async () => {
  const sdk = fakeSdk({ todos: manyTodos(11) });
  const { el, unmount } = await standalone(sdk);
  sdk.pagination.last().onPage(10);
  await settle();
  expect(shown(el)).toEqual(['todo 1']);

  [...el.shadowRoot.querySelectorAll('li button')].find((b) => b.textContent.includes('todo.delete')).click();
  await settle();

  expect(shown(el)).toHaveLength(10);
  expect(sdk.pagination.last()).toMatchObject({ offset: 0, total: 10 });
  unmount();
});

it('keeps each tables numbers apart when a plugin has two', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const [a, b] = [document.createElement('div'), document.createElement('div')];
  document.body.append(a, b);
  const stopA = mountTodoList(a.attachShadow({ mode: 'open' }), { api: sdk.api, i18n: sdk.i18n, ui: sdk.ui });
  const stopB = mountTodoList(b.attachShadow({ mode: 'open' }), { api: sdk.api, i18n: sdk.i18n, ui: sdk.ui, computerId: 7 });
  await settle();

  const [forA, forB] = [a, b].map((host) => sdk.pagination.calls.filter(([slot]) => host.shadowRoot.contains(slot)).at(-1)[1]);
  expect(forA).toMatchObject({ total: 25, loaded: 10 });
  expect(forB).toMatchObject({ total: 0, loaded: 0 });
  stopA();
  stopB();
});

it('takes its page size from how many rows fit on screen', async () => {
  const sdk = fakeSdk({ todos: manyTodos(40) });
  sdk.fit.rows = 7;
  const { el, unmount } = await standalone(sdk);

  expect(sdk.api.get).toHaveBeenCalledWith('/todos?limit=7&offset=0');
  expect(shown(el)).toHaveLength(7);
  expect(sdk.pagination.last()).toMatchObject({ pageSize: 7 });
  unmount();
});

it('keeps the page the user is on when the window changes size', async () => {
  const sdk = fakeSdk({ todos: manyTodos(40) });
  const { el, unmount } = await standalone(sdk);
  sdk.pagination.last().onPage(20); // page 3 of 4, at 10 rows
  await settle();

  sdk.fit.set(8);
  await settle();

  expect(sdk.api.get).toHaveBeenLastCalledWith('/todos?limit=8&offset=16');
  expect(sdk.pagination.last()).toMatchObject({ pageSize: 8, offset: 16 });
  expect(shown(el)).toHaveLength(8);
  unmount();
});

it('never lands past the last page when the size grows', async () => {
  const sdk = fakeSdk({ todos: manyTodos(40) });
  const { unmount } = await standalone(sdk);
  sdk.pagination.last().onPage(30); // the last page, at 10 rows
  await settle();

  sdk.fit.set(25); // 40 rows is now two pages
  await settle();

  expect(sdk.api.get).toHaveBeenLastCalledWith('/todos?limit=25&offset=25');
  unmount();
});

it('in load-more mode, a new size reloads what is held at the new size', async () => {
  const sdk = fakeSdk({ todos: manyTodos(40) });
  sdk.ui.setMode('loadMore');
  const { el, unmount } = await standalone(sdk);
  sdk.pagination.last().onLoadMore();
  await settle();
  expect(shown(el)).toHaveLength(20);

  sdk.fit.set(8);
  await settle();

  expect(sdk.api.get).toHaveBeenLastCalledWith('/todos?limit=20&offset=0');
  expect(sdk.pagination.last()).toMatchObject({ pageSize: 8, loaded: 20 });
  unmount();
});

it('stops measuring when the page goes', async () => {
  const sdk = fakeSdk({ todos: manyTodos(3) });
  const { unmount } = await standalone(sdk);
  unmount();
  expect(sdk.fit.stop).toHaveBeenCalledTimes(1);
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

it('without a pagination footer, asks for as many rows as one request carries', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const { el, unmount } = await standalone({ ...sdk, ui: undefined });

  expect(sdk.api.get).toHaveBeenCalledWith('/todos?limit=200&offset=0');
  expect(shown(el)).toHaveLength(25);
  unmount();
});

it('erases what the Core drew when the page goes', async () => {
  const sdk = fakeSdk({ todos: manyTodos(3) });
  const { unmount } = await standalone(sdk);

  unmount();
  expect(sdk.pagination.erase).toHaveBeenCalled();
  expect(sdk.ui.tableMode).toBeDefined();
});

it('still works against a backend from before paging, which answers with the whole list', async () => {
  const sdk = fakeSdk({ todos: manyTodos(25) });
  const paged = sdk.api.get.getMockImplementation();
  sdk.api.get.mockImplementation(async (path) => {
    const answer = await paged(path);
    return path === '/me' ? answer : answer.results.length ? manyTodos(25) : [];
  });
  const { el, unmount } = await standalone(sdk);

  expect(shown(el)).toHaveLength(10);
  expect(sdk.pagination.last()).toMatchObject({ total: 25, loaded: 10 });
  sdk.pagination.last().onPage(20);
  await settle();
  expect(shown(el)).toHaveLength(5);
  unmount();
});
