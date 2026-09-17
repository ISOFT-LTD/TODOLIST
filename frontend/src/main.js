// Standalone entry: runs the plugin on its own page, outside the ITSM shell.
// Same-origin /api/todos - Vite proxies it in dev, FastAPI serves it in Docker.
import { mount } from './todo-app.js';

mount(document.getElementById('app'));
