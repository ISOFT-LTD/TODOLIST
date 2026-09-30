// The standalone page's SDK: what /apps/todo/ hands the plugin where the
// ITSM shell would hand it the Core's.
//
// Standalone there is no application and so no translations. The SDK holds
// none of its own either: translate(key) answers the key, and the words of
// its own errors are keys too. What an API answered with is data and is
// passed on as it came.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreSdk } from './core-sdk.js';

function answer(status, body, headers = {}) {
  const init = { status, headers: { 'Content-Type': 'application/json', ...headers } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), init)));
}

const messageOf = (promise) => promise.then(() => null, (error) => error.message);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sdk.i18n, standalone', () => {
  it('answers a key with the key: there are no translations to read, and none are made up', () => {
    const { i18n } = createCoreSdk();
    expect(i18n.translate('todo.title')).toBe('todo.title');
    expect(i18n.translate('todo.add')).toBe('todo.add');
  });

  it('takes a listener, never calls it, and hands back what ends it', () => {
    const { i18n } = createCoreSdk();
    const listener = vi.fn();
    const stop = i18n.subscribe(listener);
    expect(typeof stop).toBe('function');
    expect(() => { stop(); stop(); }).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('sdk.api, standalone', () => {
  it('resolves to the parsed JSON, or null for an empty answer', async () => {
    const { api } = createCoreSdk();
    answer(200, [{ id: 1 }]);
    await expect(api.get('/todos')).resolves.toEqual([{ id: 1 }]);
    answer(204);
    await expect(api.delete('/todos/1')).resolves.toBeNull();
  });

  it('words its own errors by key', async () => {
    const { api } = createCoreSdk();

    answer(401, {});
    expect(await messageOf(api.get('/todos'))).toBe('todo.error-session-ended');

    answer(403, { detail: 'Insufficient permission' });
    expect(await messageOf(api.post('/todos', {}))).toBe('todo.error-read-only');

    answer(403, {});
    expect(await messageOf(api.get('/todos'))).toBe('todo.error-no-access');

    answer(503, {});
    expect(await messageOf(api.get('/todos'))).toBe('todo.error-unavailable');

    answer(500, {});
    expect(await messageOf(api.get('/todos'))).toBe('todo.error-request-failed (500)');
  });

  it("names Core's correlation id beside a server fault, the word for it by key", async () => {
    const { api } = createCoreSdk();
    answer(502, {}, { 'X-Correlation-ID': 'abc-123' });
    expect(await messageOf(api.get('/todos'))).toBe('todo.error-unavailable (todo.error-reference abc-123)');
  });

  it('passes on what the API said as it came: data, not a key', async () => {
    const { api } = createCoreSdk();

    answer(403, { detail: 'No access to this application' });
    expect(await messageOf(api.get('/todos'))).toBe('No access to this application');

    answer(422, { detail: [{ msg: 'String should have at least 1 character' }] });
    expect(await messageOf(api.post('/todos', { title: '' }))).toBe('String should have at least 1 character');

    answer(502, { detail: "The application rejected Core's identity" }, { 'X-Correlation-ID': 'abc-123' });
    expect(await messageOf(api.get('/todos'))).toBe("The application rejected Core's identity (todo.error-reference abc-123)");
  });

  it('keeps the status on the error', async () => {
    const { api } = createCoreSdk();
    answer(403, {});
    await expect(api.get('/todos')).rejects.toMatchObject({ status: 403 });
  });
});
