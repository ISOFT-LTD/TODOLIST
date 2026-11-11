// For tests only: the Core's SDK over an in-memory Todo API.

import { vi } from 'vitest';
import { fakeI18n } from './i18n.js';

/** Let pending API promises and their renders settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const VIEW = ['todo.view', 'predefined.view'];
const CHANGE = [
  'todo.create', 'todo.update', 'todo.delete',
  'predefined.create', 'predefined.update', 'predefined.delete',
];

/**
 * GET /me as the backend answers it. `canWrite` allows every action, otherwise
 * only the two views; `decisions` overrides single actions
 * ({ 'todo.create': 'REQUIRE_APPROVAL' }).
 */
export function meOf({ canWrite = true, decisions = {} } = {}) {
  const permissions = Object.fromEntries(
    [...VIEW, ...CHANGE].map((key) => [key, canWrite || VIEW.includes(key) ? 'ALLOW' : 'DENY']),
  );
  Object.assign(permissions, decisions);
  const allowed = Object.keys(permissions).filter((key) => permissions[key] === 'ALLOW').sort();
  return {
    subject: '17',
    username: 'alice',
    tenant_id: 'itec-test',
    actions: allowed,
    action_permissions: permissions,
    can_read: VIEW.some((key) => allowed.includes(key)),
    can_write: CHANGE.some((key) => allowed.includes(key)),
  };
}

/**
 * { api, navigate, notify, i18n } as a page or a contribution receives it.
 * `todos` and `lists` are what the API holds, listed in the order given.
 */
export function fakeSdk({
  i18n = fakeI18n(), canWrite = true, decisions = {}, todos = [], lists = [],
} = {}) {
  const held = {
    todos: todos.map((todo) => ({ done: false, computer_id: null, ...todo })),
    lists: lists.map((list) => ({ ...list, items: [...list.items] })),
  };
  let nextId = 100;
  const idOf = (path) => Number(String(path).split('?')[0].split('/').pop());
  const kindOf = (path) => (String(path).startsWith('/predefined-lists') ? 'lists' : 'todos');

  const api = {
    get: vi.fn(async (path) => {
      if (path === '/me') return meOf({ canWrite, decisions });
      if (path === '/health') return { status: 'ok' };
      if (kindOf(path) === 'lists') return held.lists.map((list) => ({ ...list }));
      const query = new URL(path, 'http://api.invalid').searchParams;
      const computer = query.get('computer_id');
      const mine = held.todos.filter((todo) => computer === null || todo.computer_id === Number(computer));
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? mine.length);
      return {
        results: mine.slice(offset, offset + limit).map((todo) => ({ ...todo })),
        total: mine.length,
        open: mine.filter((todo) => !todo.done).length,
      };
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

  // The Core's own table mode, list footer and loader. pagination.last() is
  // what the table last asked the Core to draw: its numbers and its callbacks.
  const pagination = { last: () => pagination.calls.at(-1)?.[1], calls: [], erase: vi.fn() };
  const modeListeners = new Set();
  let mode = 'pagination';
  const ui = {
    tableMode: vi.fn(() => mode),
    onTableModeChange: vi.fn((listener) => { modeListeners.add(listener); return () => modeListeners.delete(listener); }),
    pagination: vi.fn((el, props) => { pagination.calls.push([el, props]); return pagination.erase; }),
    loading: vi.fn(() => vi.fn()),
    /** The user changing the table-mode setting. */
    setMode(next) { mode = next; modeListeners.forEach((listener) => listener()); },
  };

  return { api, navigate: vi.fn(), notify: vi.fn(), i18n, ui, pagination };
}
