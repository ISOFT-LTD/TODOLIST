// Standalone entry: runs the plugin outside the ITSM shell, with the local
// development SDK standing in for the SDK that Core provides.
import { createLocalSdk } from './dev-sdk.js';
import { mount } from './todo-app.js';

mount(document.getElementById('app'), { sdk: createLocalSdk() });
