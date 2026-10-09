/**
 * The SDK this UI gets when its page is served by Cobalt Core.
 *
 * Core serves the app at /apps/todo/ and forwards everything under that path to
 * the app's gateway. So the API is simply "api/..." relative to this page, on
 * Core's own origin: the browser sends Core's HttpOnly session cookie with the
 * call, Core checks the session, mints a short-lived token for this app and
 * forwards the request. Nothing here sees, stores or sends a token - there is
 * none to handle.
 *
 * The same relative URL works under `npm run dev`, where Vite forwards /api to
 * a local stand-in for Core (dev/fake_core.py).
 *
 * Contract, the same one the ITSM shell's SDK must honour:
 *   api.get(path) / post(path, body) / put(path, body) / delete(path)
 *   - path is relative to this app's API, e.g. '/todos/1'
 *   - resolves to the parsed JSON, or null for an empty response
 *   - rejects with an Error whose message is safe to show the user
 *   i18n.translate(key) / subscribe(listener)
 *   - the application's translations. Standalone there is no application
 *     and so there are none: a key is answered with the key, as the Core
 *     answers for one it has no text for. There is no table of words here,
 *     and none anywhere in the app - the page then shows its keys, which is
 *     what it should show when nothing can translate them.
 *
 * This SDK words its own errors the same way, by key: what Core's statuses
 * mean is its to say, and it holds no words to say it with. What the API
 * itself answered - a `detail`, the status text - is data and is passed on
 * as it came. To the UI every message is data, shown as it comes.
 */

const API_ROOT = new URL('api/', document.baseURI);

function apiUrl(path) {
  return new URL(String(path).replace(/^\/+/, ''), API_ROOT);
}

/** The translations of the standalone page: none. A key is its own answer. */
const i18n = {
  translate: (key) => key,
  subscribe: () => () => {},
};

/** What Core's statuses mean to a person looking at this page. */
async function describe(res) {
  const t = i18n.translate;
  const body = await res.json().catch(() => ({}));
  let detail = '';
  if (typeof body.detail === 'string') detail = body.detail;
  else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
  const reference = res.headers.get('X-Correlation-ID');
  const withReference = (text) => (reference ? `${text} (${t('todo.error-reference')} ${reference})` : text);

  switch (res.status) {
    // Core answers 401 only when the Cobalt session itself is gone.
    case 401:
      return t('todo.error-session-ended');
    // Core's own 403 (no access to the app) or this service's (read only).
    case 403:
      return detail === 'Insufficient permission'
        ? t('todo.error-read-only')
        : detail || t('todo.error-no-access');
    // A server-side fault, never the user's session: say so, with Core's
    // correlation id so an administrator can find the log line.
    case 502:
    case 503:
    case 504:
      return withReference(detail || t('todo.error-unavailable'));
    default:
      return detail || res.statusText || `${t('todo.error-request-failed')} (${res.status})`;
  }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(apiUrl(path), {
    method,
    // Same origin as Core, so the session cookie goes with the call. Never a
    // token: Core adds the one this service verifies, on its own side.
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const error = new Error(await describe(res));
    error.status = res.status;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

export function createCoreSdk() {
  return {
    api: {
      get: (path) => request('GET', path),
      post: (path, body) => request('POST', path, body),
      put: (path, body) => request('PUT', path, body),
      delete: (path) => request('DELETE', path),
    },
    i18n,
  };
}
