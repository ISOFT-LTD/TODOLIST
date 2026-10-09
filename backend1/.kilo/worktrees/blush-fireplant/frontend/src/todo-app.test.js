// The standalone page is unchanged by the Computer Details contributions:
// still every todo, still added without a computer.

import { expect, it, vi } from 'vitest';
import { en, fakeI18n } from './testing/i18n.js';
import { mount } from './todo-app.js';

it('lists every todo, saying which computer one is about', async () => {
  const api = {
    get: vi.fn(async (path) => (path === '/me' ? { username: 'alice', can_write: true } : [
      { id: 2, title: 'Replace the disk', done: false, computer_id: 42 },
      { id: 1, title: 'Buy milk', done: false, computer_id: null },
    ])),
    post: vi.fn(async (path, body) => ({ id: 3, done: false, computer_id: null, ...body })),
    put: vi.fn(),
    delete: vi.fn(),
  };
  const el = document.createElement('div');
  document.body.append(el);

  const unmount = mount(el, { sdk: { api, i18n: fakeI18n() }, path: '' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(api.get).toHaveBeenCalledWith('/todos');
  expect([...el.shadowRoot.querySelectorAll('li .tag')].map((n) => n.textContent)).toEqual([`${en('todo.computer')} 42`]);

  el.shadowRoot.querySelector('.new-title').value = 'Call IT';
  el.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(api.post).toHaveBeenCalledWith('/todos', { title: 'Call IT' });

  unmount();
  el.remove();
});
