/**
 * The Predefined to do list page: reusable templates, each a name and the
 * items it would create - "New Employee Setup: create account, assign laptop,
 * ...". View, create, edit and delete them. Turning a template into real
 * todos is a later feature.
 *
 *   const teardown = mountPredefinedLists(shadowRoot, { api, i18n });
 *
 * Renders into the shadow root the plugin shell prepared (styles already in
 * place) and talks to the API only through `api` (see todo-app.js). Its
 * words come from `i18n`, the application's translations, through the
 * plugin's translation helper: a change of language redraws them in place.
 */

import { createPluginTranslation } from '../plugin-translation.js';
import { ACTIONS, hasAction } from '../actions.js';
import { appendHtml, describeUser, whoIsCalling } from './shared.js';

const TEMPLATE = `
  <main class="todo">
    <h1 data-i18n="todo.predefined-title"></h1>
    <p class="who" hidden></p>
    <form class="add-form template-form" hidden>
      <input type="text" class="new-name" data-i18n-placeholder="todo.list-name-placeholder" autocomplete="off" required>
      <textarea class="new-items" rows="4" data-i18n-placeholder="todo.list-items-placeholder" required></textarea>
      <button type="submit" class="primary" data-i18n="todo.add-list"></button>
    </form>
    <ul class="list"></ul>
    <p class="error" hidden></p>
  </main>
`;

/** One item per line; blank lines are ignored. */
function parseItems(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function mountPredefinedLists(root, { api, i18n }) {
  appendHtml(root, TEMPLATE);
  const texts = createPluginTranslation(i18n, root);

  const list = root.querySelector('.list');
  const form = root.querySelector('.template-form');
  const nameInput = root.querySelector('.new-name');
  const itemsInput = root.querySelector('.new-items');
  const errorBox = root.querySelector('.error');
  const who = root.querySelector('.who');

  let destroyed = false;
  let editingId = null;
  let canCreate = false;
  let canUpdate = false;
  let canDelete = false;
  let me = null;

  /** An error as the SDK worded it: data, shown as it is. */
  const showError = (msg) => {
    if (destroyed) return;
    texts.plain(errorBox, msg);
    errorBox.hidden = !msg;
  };

  /** Something wrong with what was entered, in the plugin's own words. */
  const showProblem = (key) => {
    if (destroyed) return;
    texts.text(errorBox, key);
    errorBox.hidden = false;
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
    texts.text(ok, 'todo.save');
    ok.className = 'primary';
    ok.onclick = () => save(template.id, name.value, items.value);
    actions.append(ok);

    const cancel = document.createElement('button');
    texts.text(cancel, 'todo.cancel');
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

    if (canUpdate) {
      const editBtn = document.createElement('button');
      texts.text(editBtn, 'todo.edit');
      editBtn.onclick = () => { editingId = template.id; load(); };
      head.append(editBtn);
    }

    if (canDelete) {
      const del = document.createElement('button');
      texts.text(del, 'todo.delete');
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
      const empty = document.createElement('p');
      empty.className = 'empty';
      texts.text(empty, 'todo.no-predefined-lists');
      list.append(empty);
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

  /** Who is signed in, in the words of the moment. */
  function drawWho() {
    if (!me) return;
    who.textContent = describeUser(me, texts.t, canCreate || canUpdate || canDelete);
    who.hidden = !who.textContent;
  }
  texts.onChange(drawWho);

  async function loadIdentity() {
    const found = await whoIsCalling(api);
    if (!found || destroyed) return;
    me = found;
    canCreate = hasAction(me, ACTIONS.PREDEFINED_CREATE);
    canUpdate = hasAction(me, ACTIONS.PREDEFINED_UPDATE);
    canDelete = hasAction(me, ACTIONS.PREDEFINED_DELETE);
    drawWho();
    form.hidden = !canCreate;
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
    if (!name.trim()) return showProblem('todo.list-name-required');
    if (!items.length) return showProblem('todo.list-items-required');
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
    if (!items.length) return showProblem('todo.list-items-required');
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
    texts.stop();
  };
}
