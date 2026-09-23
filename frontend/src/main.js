// Standalone entry: the page Cobalt Core serves at /apps/todo/. It mounts the
// same federated module the ITSM shell will load, with the SDK that reaches
// this app's API through Core.
import { createCoreSdk } from './core-sdk.js';
import { mount } from './todo-app.js';

mount(document.getElementById('app'), { sdk: createCoreSdk() });
