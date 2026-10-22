/**
 * The "To do" tab on the Core's Computer Details page - exposed to the Core
 * as ./ComputerTodoTab for the `computer.details.tabs` target.
 *
 *   const { update, unmount } = mount(el, { computerId }, sdk);
 *
 * It is the plugin's own To do List (pages/todo-list.js), scoped to the
 * computer: that computer's todos, ticked, edited and deleted as on the
 * standalone page, and new ones added to it. A todo added from the header
 * action appears here without a reload.
 *
 * The Core draws the tab itself, from the manifest's `label`, and translates
 * it. This module renders only the tab's content, in words from sdk.i18n.
 */

import styles from '../styles.css?inline';
import { mountTodoList } from '../pages/todo-list.js';
import { appendHtml } from '../pages/shared.js';
import { createPluginTranslation } from '../plugin-translation.js';
import { createContribution } from './contribution.js';

function renderTab(root, { computerId, sdk }) {
  if (computerId === null) {
    appendHtml(root, '<main class="todo embedded"><p class="empty" data-i18n="todo.no-computer"></p></main>');
    const texts = createPluginTranslation(sdk.i18n, root);
    return () => texts.stop();
  }
  return mountTodoList(root, { api: sdk.api, i18n: sdk.i18n, computerId });
}

export const mount = createContribution({ name: 'ComputerTodoTab', styles, render: renderTab });

export default { mount };
