/**
 * The Predefined to do list page: reusable templates, each a name and the
 * items it would create - "New Employee Setup: create account, assign laptop,
 * ...". View, create, edit and delete them. Turning a template into real
 * todos is a later feature.
 *
 *   const teardown = mountPredefinedLists(shadowRoot, { api });
 *
 * Renders into the shadow root the plugin shell prepared (styles already in
 * place) and talks to the API only through `api` (see todo-app.js).
 */

import { appendHtml, describeUser, whoIsCalling } from './shared.js';

const TEMPLATE = `
  <main class="todo">
    <h1>Predefined to do lists</h1>
    <p class="who" hidden></p>
    <form class="add-form template-form">
      <input type="text" class="new-name" placeholder="List name, e.g. New Employee Setup" autocomplete="off" required>
      <textarea class="new-items" rows="4" placeholder="One item per line" required></textarea>
      <button type="submit" class="primary">Add list</button>
    </form>
    <ul class="list"></ul>
    <p class="error" hidden></p>
  </main>
`;

/** One item per line; blank lines are ignored. */
function parseItems(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function mountPredefinedLists(root, { api }) {
  appendHtml(root, TEMPLATE);

  const list = root.querySelector('.list');
  const form = root.querySelector('.template-form');
  const nameInput = root.querySelector('.new-name');
  const itemsInput = root.querySelector('.new-items');
  const errorBox = root.querySelector('.error');
  const who = root.querySelector('.who');

  let destroyed = false;
  let editingId = null;
  // Until GET /me says otherwise. The service enforces it either way.
  let canWrite = true;

  const showError = (msg) => {
    if (destroyed) return;
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  };

  function renderEditor(li, template) {
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'edit-name';
    name.value = template.name;
    li.append(name);

    const items = document.createElement('textarea');
    items.className = 'edit-items';
    items.rows = Math.max(3, template.items.length + 1);
    items.value = template.items.join('\n');
    li.append(items);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const ok = document.createElement('button');
    ok.textContent = 'Save';
    ok.className = 'primary';
    ok.onclick = () => save(template.id, name.value, items.value);
    actions.append(ok);

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = () => { editingId = null; load(); };
    actions.append(cancel);

    li.append(actions);

    name.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(template.id, name.value, items.value); }
      if (e.key === 'Escape') { editingId = null; load(); }
    };
    items.onkeydown = (e) => {
      if (e.key === 'Escape') { editingId = null; load(); }
    };
    setTimeout(() => name.focus(), 0);
  }

  function renderCard(li, template) {
    const head = document.createElement('div');
    head.className = 'head';

    const name = document.createElement('span');
    name.className = 'title';
    name.textContent = template.name;
    head.append(name);

    if (canWrite) {
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.onclick = () => { editingId = template.id; load(); };
      head.append(editBtn);

      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.onclick = () => remove(template.id);
      head.append(del);
    }
    li.append(head);

    const items = document.createElement('ol');
    items.className = 'items';
    for (const item of template.items) {
      const entry = document.createElement('li');
      entry.textContent = item;
      items.append(entry);
    }
    li.append(items);
  }

  function render(templates) {
    if (destroyed) return;
    list.innerHTML = '';
    if (!templates.length) {
      list.innerHTML = '<p class="empty">No predefined lists yet.</p>';
      return;
    }
    for (const template of templates) {
      const li = document.createElement('li');
      li.className = 'template';
      if (editingId === template.id) renderEditor(li, template);
      else renderCard(li, template);
      list.append(li);
    }
  }

  async function loadIdentity() {
    const me = await whoIsCalling(api);
    if (!me || destroyed) return;
    canWrite = me.canWrite;
    who.textContent = describeUser(me);
    who.hidden = !who.textContent;
    form.hidden = !canWrite;
  }

  async function load() {
    try {
      showError('');
      render(await api.get('/predefined-lists'));
    } catch (err) {
      showError(err.message);
    }
  }

  async function save(id, name, itemsText) {
    const items = parseItems(itemsText);
    if (!name.trim()) return showError('Give the list a name.');
    if (!items.length) return showError('Add at least one item, one per line.');
    try {
      await api.put(`/predefined-lists/${id}`, { name: name.trim(), items });
      editingId = null;
      load();
    } catch (err) {
      showError(err.message);
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/predefined-lists/${id}`);
      load();
    } catch (err) {
      showError(err.message);
    }
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const items = parseItems(itemsInput.value);
    if (!name) return;
    if (!items.length) return showError('Add at least one item, one per line.');
    try {
      await api.post('/predefined-lists', { name, items });
      nameInput.value = '';
      itemsInput.value = '';
      load();
    } catch (err) {
      showError(err.message);
    }
  };

  loadIdentity().then(load);

  return () => {
    destroyed = true;
  };
}
