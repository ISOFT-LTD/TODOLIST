/**
 * The Todo section in the Core's User Settings - exposed to the Core as
 * ./TodoUserSettings for the `settings.navigation.user` target.
 *
 *   const { update, unmount } = mount(el, {}, sdk);
 *
 * Settings is about no record, so the context is empty. The section says who
 * is calling and how many of their todos are still open, from the plugin's own
 * API: enough to show the target mounts, talks through the SDK and translates.
 *
 * The Core draws the entry itself, from the manifest's `label`, and translates
 * it. This module renders only the section's content, in words from sdk.i18n.
 */

import styles from '../styles.css?inline';
import { appendHtml, describeUser, whoIsCalling } from '../pages/shared.js';
import { createPluginTranslation } from '../plugin-translation.js';
import { createContribution } from './contribution.js';

function renderUserSettings(root, { sdk }) {
  appendHtml(root, `
    <main class="todo embedded">
      <h2 data-i18n="todo.title"></h2>
      <p class="who" hidden></p>
      <p class="summary" hidden><span data-i18n="todo.open-todos"></span> <strong class="count"></strong></p>
      <p class="error" data-i18n="todo.error-request-failed" hidden></p>
    </main>`);
  const texts = createPluginTranslation(sdk.i18n, root);
  const who = root.querySelector('.who');
  const summary = root.querySelector('.summary');
  let live = true;

  whoIsCalling(sdk.api).then((me) => {
    if (!live) return;
    const draw = () => {
      who.textContent = describeUser(me, texts.t);
      who.hidden = who.textContent === '';
    };
    draw();
    texts.onChange(draw);
  });

  sdk.api.get('/todos').then(
    (todos) => {
      if (!live) return;
      const open = Array.isArray(todos) ? todos.filter((todo) => !todo.done).length : 0;
      root.querySelector('.count').textContent = String(open);
      summary.hidden = false;
    },
    () => {
      if (live) root.querySelector('.error').hidden = false;
    },
  );

  return () => {
    live = false;
    texts.stop();
  };
}

export const mount = createContribution({ name: 'TodoUserSettings', styles, render: renderUserSettings });

export default { mount };
