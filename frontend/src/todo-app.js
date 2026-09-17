/**
 * Todo plugin UI - exposed to the ITSM shell through Module Federation.
 *
 * Framework-agnostic on purpose: the shell calls mount() from a React effect,
 * so the plugin never bundles or shares React.
 *
 * The plugin reaches the outside world only through the SDK it is given. It
 * never imports Core code and knows nothing about URLs, sessions or transport:
 * in the ITSM shell, Core's SDK routes sdk.api through Core; standalone, the
 * local development SDK (dev-sdk.js) calls the Todo service directly.
 *
 *   const unmount = mount(element, { sdk });
 *
 * SDK contract this plugin relies on:
 *   sdk.api.get(path) / post(path, body) / put(path, body) / delete(path)
 *   - path is relative to this plugin's API, e.g. '/todos/1'
 *   - resolves to the parsed JSON response, or null when there is no body
 *   - rejects with an Error whose message is safe to show the user
 */

import styles from './styles.css?inline';

const TEMPLATE = `
  <main class="todo">
    <h1>Todo List</h1>
    <form class="add-form">
      <input type="text" class="new-title" placeholder="What needs doing?" autocomplete="off" required>
      <button type="submit" class="primary">Add</button>
    </form>
    <ul class="list"></ul>
    <p class="error" hidden></p>
  </main>
`;

const instances = new WeakMap();

const API_METHODS = ['get', 'post', 'put', 'delete'];

/**
 * Render the todo app into `el`.
 *
 * @param {HTMLElement} el Container owned by the host.
 * @param {object} options
 * @param {object} options.sdk Host SDK. Only sdk.api is used.
 * @returns {() => void} Unmount function.
 */
export function mount(el, { sdk } = {}) {
  if (!(el instanceof HTMLElement)) {
    throw new Error('todo-plugin: mount() needs a container element');
  }
  const missing = API_METHODS.filter((m) => typeof sdk?.api?.[m] !== 'function');
  if (missing.length) {
    throw new Error(`todo-plugin: mount() needs { sdk } with sdk.api.${missing.join(', sdk.api.')}`);
  }
  const { api } = sdk;

  // Remount cleanly. React StrictMode mounts, unmounts, then mounts again.
  unmount(el);

  // attachShadow() can only run once per element, so reuse it on remount.
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${styles}</style>${TEMPLATE}`;

  const list = root.querySelector('.list');
  const form = root.querySelector('.add-form');
  const input = root.querySelector('.new-title');
  const errorBox = root.querySelector('.error');

  let destroyed = false;
  let editingId = null;

  const showError = (msg) => {
    if (destroyed) return;
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  };

  function render(todos) {
    if (destroyed) return;
    list.innerHTML = '';
    if (!todos.length) {
      list.innerHTML = '<p class="empty">Nothing here yet.</p>';
      return;
    }
    for (const todo of todos) {
      const li = document.createElement('li');
      if (todo.done) li.className = 'done';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = todo.done;
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
        ok.textContent = 'Save';
        ok.className = 'primary';
        ok.onclick = () => update(todo.id, { title: edit.value });
        li.append(ok);
      } else {
        const span = document.createElement('span');
        span.className = 'title';
        span.textContent = todo.title;
        li.append(span);

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => { editingId = todo.id; load(); };
        li.append(editBtn);
      }

      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.onclick = () => remove(todo.id);
      li.append(del);

      list.append(li);
    }
  }

  async function load() {
    try {
      showError('');
      render(await api.get('/todos'));
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
      await api.post('/todos', { title });
      input.value = '';
      load();
    } catch (err) {
      showError(err.message);
    }
  };

  instances.set(el, () => {
    destroyed = true;
    root.innerHTML = '';
  });

  load();
  return () => unmount(el);
}

/** Tear down the app rendered into `el`. Safe to call more than once. */
export function unmount(el) {
  const teardown = instances.get(el);
  if (!teardown) return;
  instances.delete(el);
  teardown();
}

export default { mount, unmount };
