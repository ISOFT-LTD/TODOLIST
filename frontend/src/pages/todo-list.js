/**
 * The To do List page: this user's todos, with add, edit, tick and delete.
 *
 *   const teardown = mountTodoList(shadowRoot, { api, i18n });
 *   const teardown = mountTodoList(shadowRoot, { api, i18n, computerId: 42 });
 *
 * Renders into the shadow root the plugin shell prepared (styles already in
 * place) and talks to the API only through `api` (see todo-app.js). Its
 * words come from `i18n`, the application's translations, through the
 * plugin's translation helper: a change of language redraws them in place.
 *
 * With `computerId` it is the same list about one Core computer - what the
 * Computer Details tab shows: only that computer's todos, and new ones are
 * added to it. Without, it is the standalone page: every todo, each one that
 * is about a computer saying which.
 */

import { createPluginTranslation } from '../plugin-translation.js';
import { onTodosChanged } from '../todo-events.js';
import { appendHtml, describeUser, whoIsCalling } from './shared.js';

const TEMPLATE = `
  <main class="todo">
    <h1 data-i18n="todo.title"></h1>
    <p class="who" hidden></p>
    <form class="add-form">
      <input type="text" class="new-title" data-i18n-placeholder="todo.new-todo-placeholder" autocomplete="off" required>
      <button type="submit" class="primary" data-i18n="todo.add"></button>
    </form>
    <ul class="list"></ul>
    <p class="error" hidden></p>
  </main>
`;

const EMBEDDED_TEMPLATE = `
  <main class="todo embedded">
    <p class="who" hidden></p>
    <form class="add-form">
      <input type="text" class="new-title" data-i18n-placeholder="todo.new-computer-todo-placeholder" autocomplete="off" required>
      <button type="submit" class="primary" data-i18n="todo.add"></button>
    </form>
    <ul class="list"></ul>
    <p class="error" hidden></p>
  </main>
`;

export function mountTodoList(root, { api, i18n, computerId = null }) {
  const scoped = computerId !== null;
  appendHtml(root, scoped ? EMBEDDED_TEMPLATE : TEMPLATE);
  const texts = createPluginTranslation(i18n, root);
  const listPath = scoped ? `/todos?computer_id=${encodeURIComponent(computerId)}` : '/todos';

  const list = root.querySelector('.list');
  const form = root.querySelector('.add-form');
  const input = root.querySelector('.new-title');
  const errorBox = root.querySelector('.error');
  const who = root.querySelector('.who');

  let destroyed = false;
  let editingId = null;
  // Until GET /me says otherwise. The service enforces it either way.
  let canWrite = true;
  let me = null;

  /** An error as the SDK worded it: data, shown as it is. */
  const showError = (msg) => {
    if (destroyed) return;
    texts.plain(errorBox, msg);
    errorBox.hidden = !msg;
  };

  function render(todos) {
    if (destroyed) return;
    list.innerHTML = '';
    if (!todos.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      texts.text(empty, scoped ? 'todo.no-computer-todos' : 'todo.no-todos');
      list.append(empty);
      return;
    }
    for (const todo of todos) {
      const li = document.createElement('li');
      if (todo.done) li.className = 'done';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = todo.done;
      check.disabled = !canWrite;
      check.onchange = () => update(todo.id, { done: check.checked });
      li.append(check);

      if (editingId === todo.id) {
        const edit = document.createElement('input');
        edit.type = 'text';
        edit.value = todo.title;
        edit.style.flex = '1';
        edit.onkeydown = (e) => {
          if (e.key === 'Enter') update(todo.id, { title: edit.value });
          if (e.key === 'Escape') { editingId = null; load(); }
        };
        li.append(edit);
        setTimeout(() => edit.focus(), 0);

        const ok = document.createElement('button');
        texts.text(ok, 'todo.save');
        ok.className = 'primary';
        ok.onclick = () => update(todo.id, { title: edit.value });
        li.append(ok);
      } else {
        const span = document.createElement('span');
        span.className = 'title';
        span.textContent = todo.title;
        li.append(span);

        // The standalone list says which computer a todo is about; the
        // computer's own tab needs no reminder. The word is translated, the
        // id is data.
        if (!scoped && todo.computer_id != null) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.append(texts.text(document.createElement('span'), 'todo.computer'), ` ${todo.computer_id}`);
          li.append(tag);
        }

        const editBtn = document.createElement('button');
        texts.text(editBtn, 'todo.edit');
        editBtn.onclick = () => { editingId = todo.id; load(); };
        if (canWrite) li.append(editBtn);
      }

      if (canWrite) {
        const del = document.createElement('button');
        texts.text(del, 'todo.delete');
        del.onclick = () => remove(todo.id);
        li.append(del);
      }

      list.append(li);
    }
  }

  /** Who is signed in, in the words of the moment. */
  function drawWho() {
    if (!me) return;
    // Inside the Core the user knows who they are; only say "read only".
    who.textContent = scoped ? (me.canWrite ? '' : texts.t('todo.read-only')) : describeUser(me, texts.t);
    who.hidden = !who.textContent;
  }
  texts.onChange(drawWho);

  async function loadIdentity() {
    const found = await whoIsCalling(api);
    if (!found || destroyed) return;
    me = found;
    canWrite = me.canWrite;
    drawWho();
    form.hidden = !canWrite;
  }

  async function load() {
    try {
      showError('');
      render(await api.get(listPath));
    } catch (err) {
      showError(err.message);
    }
  }

  async function update(id, changes) {
    try {
      await api.put(`/todos/${id}`, changes);
      editingId = null;
      load();
    } catch (err) {
      showError(err.message);
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/todos/${id}`);
      load();
    } catch (err) {
      showError(err.message);
    }
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    try {
      await api.post('/todos', scoped ? { title, computer_id: computerId } : { title });
      input.value = '';
      load();
    } catch (err) {
      showError(err.message);
    }
  };

  loadIdentity().then(load);

  // A todo added elsewhere in this plugin - the Computer Details header
  // action - shows up here without a reload.
  const stopListening = onTodosChanged((change) => {
    if (!scoped || change.computerId === computerId) load();
  });

  return () => {
    destroyed = true;
    stopListening();
    texts.stop();
  };
}
