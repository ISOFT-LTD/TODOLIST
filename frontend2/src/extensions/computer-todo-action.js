/**
 * "Add Todo" in the Core's Computer Details header - exposed to the Core as
 * ./ComputerTodoAction for the `computer.details.header.actions` target.
 *
 *   const { update, unmount } = mount(el, { computerId }, sdk);
 *
 * A compact button beside the Core's own header actions. It opens a small
 * dialog - rendered inside this contribution's own element, shown in the
 * browser's top layer so the header's layout cannot clip it - that adds a
 * todo about this computer through the same API the To do List uses. The Core
 * shows the confirmation, and the To do tab, if open, lists the new todo.
 *
 * Its words come from sdk.i18n, the application's translations. A change of
 * language redraws them in place: an open dialog stays open, with what was
 * typed in it.
 *
 * The manifest asks the Core to show it only to users who may add todos
 * (todo.create); the API refuses anyone else regardless.
 */

import { createPluginTranslation } from '../plugin-translation.js';
import { todosChanged } from '../todo-events.js';
import { ACTIONS, hasAction } from '../actions.js';
import { appendHtml } from '../pages/shared.js';
import { createContribution, notify } from './contribution.js';
import styles from './computer-todo-action.css?inline';

const TEMPLATE = `
  <button type="button" class="open" data-i18n-title="todo.add-computer-todo-tooltip" hidden>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>
    <span data-i18n="todo.add-todo"></span>
  </button>
  <dialog aria-labelledby="todo-dialog-title">
    <form method="dialog" class="add-form">
      <h2 id="todo-dialog-title" data-i18n="todo.add-computer-todo-title"></h2>
      <input type="text" class="new-title" data-i18n-placeholder="todo.new-todo-placeholder" autocomplete="off" maxlength="255" required>
      <p class="error" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="cancel" data-i18n="todo.cancel"></button>
        <button type="submit" class="primary save" data-i18n="todo.add"></button>
      </div>
    </form>
  </dialog>
`;

function renderAction(root, { computerId, sdk }) {
  // No computer, nothing to add a todo to: render nothing rather than a
  // button that can only fail.
  if (computerId === null) return () => {};

  appendHtml(root, TEMPLATE);
  const texts = createPluginTranslation(sdk.i18n, root);

  const open = root.querySelector('.open');
  const dialog = root.querySelector('dialog');
  const form = root.querySelector('form');
  const input = root.querySelector('.new-title');
  const errorBox = root.querySelector('.error');
  const cancel = root.querySelector('.cancel');
  const save = root.querySelector('.save');

  let destroyed = false;

  sdk.api.get('/me').then((me) => {
    if (!destroyed) open.hidden = !hasAction({
      actions: Array.isArray(me?.actions) ? me.actions : null,
      canWrite: Boolean(me?.can_write),
    }, ACTIONS.TODO_CREATE);
  }).catch(() => {});

  /** An error as the SDK worded it: data, shown as it is. */
  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  };

  function show() {
    showError('');
    input.value = '';
    // showModal() puts the dialog in the top layer; an environment without it
    // still gets an open dialog.
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    input.focus();
  }

  function hide() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  open.addEventListener('click', show);
  cancel.addEventListener('click', hide);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;

    save.disabled = true;
    showError('');
    try {
      await sdk.api.post('/todos', { title, computer_id: computerId });
      if (destroyed) return;
      hide();
      todosChanged({ computerId });
      notify(sdk, 'success', texts.t('todo.computer-todo-added'));
    } catch (err) {
      if (!destroyed) showError(err.message);
    } finally {
      if (!destroyed) save.disabled = false;
    }
  });

  return () => {
    destroyed = true;
    texts.stop();
    // A modal dialog left open would hold the page's focus and the top layer.
    if (dialog.open) hide();
  };
}

export const mount = createContribution({ name: 'ComputerTodoAction', styles, render: renderAction });

export default { mount };
