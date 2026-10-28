/**
 * The Todo section in the Core's Configuration (system) Settings - exposed to
 * the Core as ./TodoSystemSettings for the `settings.navigation.system` target.
 *
 *   const { update, unmount } = mount(el, {}, sdk);
 *
 * Settings is about no record, so the context is empty. The section shows the
 * service's status as GET /health answers it, through the Core: enough to show
 * the target mounts, reaches the plugin's API and translates.
 *
 * The Core draws the entry itself, from the manifest's `label`, and translates
 * it. This module renders only the section's content, in words from sdk.i18n.
 */

import styles from '../styles.css?inline';
import { appendHtml } from '../pages/shared.js';
import { createPluginTranslation } from '../plugin-translation.js';
import { createContribution } from './contribution.js';

function renderSystemSettings(root, { sdk }) {
  appendHtml(root, `
    <main class="todo embedded">
      <h2 data-i18n="todo.title"></h2>
      <p class="summary" hidden><span data-i18n="todo.service-status"></span> <strong class="status"></strong></p>
      <p class="error" data-i18n="todo.error-unavailable" hidden></p>
    </main>`);
  const texts = createPluginTranslation(sdk.i18n, root);
  let live = true;

  sdk.api.get('/health').then(
    (health) => {
      if (!live) return;
      // The status is data: shown as the service worded it.
      texts.plain(root.querySelector('.status'), String(health?.status ?? ''));
      root.querySelector('.summary').hidden = false;
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

export const mount = createContribution({ name: 'TodoSystemSettings', styles, render: renderSystemSettings });

export default { mount };
