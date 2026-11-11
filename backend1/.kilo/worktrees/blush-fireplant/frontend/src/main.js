// Standalone entry: the page Cobalt Core serves at /apps/todo/. It mounts the
// same federated module the ITSM shell will load, with the SDK that reaches
// this app's API through Core. Which page shows follows the address:
// /apps/todo/ is the To do List, /apps/todo/predefined the predefined lists.
//
// Standalone there are no translations to read, and the app holds none of
// its own, so everything here shows its key: the page's two links and its
// title like the plugin's own text.
import { createCoreSdk } from './core-sdk.js';
import { createPluginTranslation } from './plugin-translation.js';
import { mount } from './todo-app.js';

const sdk = createCoreSdk();

// The page's own chrome, named by key in index.html like any other markup.
createPluginTranslation(sdk.i18n, document.querySelector('.pages'));
document.title = sdk.i18n.translate('todo.title');

mount(document.getElementById('app'), { sdk });
