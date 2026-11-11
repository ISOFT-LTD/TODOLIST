// For tests only: the Core's SDK over an in-memory Todo API.

import { vi } from 'vitest';
import { fakeI18n } from './i18n.js';

/** Let pending API promises and their renders settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * { api, navigate, notify, i18n } as a page or a contribution receives it.
 * `todos` and `lists` are what the API holds, listed in the order given.
 */
export function fakeSdk({ i18n = fakeI18n(), canWrite = true, todos = [], lists = [] } = {}) {
  const held = {
    todos: todos.map((todo) => ({ done: false, computer_id: null, ...todo })),
    lists: lists.map((list) => ({ ...list, items: [...list.items] })),
  };
  let nextId = 100;
  const idOf = (path) => Number(String(path).split('?')[0].split('/').pop());
  const kindOf = (path) => (String(path).startsWith('/predefined-lists') ? 'lists' : 'todos');

  const api = {
    get: vi.fn(async (path) => {
      if (path === '/me') return { username: 'alice', can_write: canWrite };
      if (kindOf(path) === 'lists') return held.lists.map((list) => ({ ...list }));
      const query = new URL(path, 'http://api.invalid').searchParams;
      const computer = query.get('computer_id');
      const mine = held.todos.filter((todo) => computer === null || todo.computer_id === Number(computer));
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? mine.length);
      return { results: mine.slice(offset, offset + limit).map((todo) => ({ ...todo })), total: mine.length };
    }),
    post: vi.fn(async (path, body) => {
      const record = kindOf(path) === 'lists'
        ? { id: nextId++, ...body }
        : { id: nextId++, done: false, computer_id: null, ...body };
      held[kindOf(path)].unshift(record);
      return record;
    }),
    put: vi.fn(async (path, body) => Object.assign(held[kindOf(path)].find((r) => r.id === idOf(path)), body)),
    delete: vi.fn(async (path) => {
      const records = held[kindOf(path)];
      records.splice(records.findIndex((r) => r.id === idOf(path)), 1);
      return null;
    }),
  };

  // The Core's own list footer, loader and download button. Each records its
  // calls; pager.options.onChange is the Core asking for a page.
  const pager = { update: vi.fn(), destroy: vi.fn(), options: null };
  const ui = {
    pager: vi.fn((el, options) => { pager.options = options; return pager; }),
    loading: vi.fn(() => vi.fn()),
    exportButton: vi.fn(() => vi.fn()),
  };

  return { api, navigate: vi.fn(), notify: vi.fn(), i18n, ui, pager };
}
