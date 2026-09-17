/**
 * Local SDK for standalone development only. The ITSM shell never loads this
 * file: it is imported by main.js, not by the federated todo-app.js.
 *
 * Implements only sdk.api, calling the Todo FastAPI service directly on the
 * same origin - through the Vite dev proxy on :5173, or with FastAPI serving
 * the page itself. In the shell, Core supplies its own sdk.api that goes
 * through the Core backend instead.
 */

const API_ROOT = '/api';

async function errorMessage(res) {
  const { detail } = await res.json().catch(() => ({}));
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return res.statusText || `Request failed (${res.status})`;
}

async function request(method, path, body) {
  const res = await fetch(API_ROOT + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.status === 204 ? null : res.json();
}

export function createLocalSdk() {
  return {
    api: {
      get: (path) => request('GET', path),
      post: (path, body) => request('POST', path, body),
      put: (path, body) => request('PUT', path, body),
      delete: (path) => request('DELETE', path),
    },
  };
}
