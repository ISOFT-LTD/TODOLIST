// For tests only: the application's translations, standing in.
//
// It holds no words. It answers every key with the key itself, marked with
// the language of the moment - ⟦en:todo.add⟧, then ⟦pt:todo.add⟧ after a
// change - so a test can tell that a text came from sdk.i18n, for which key,
// and in which language, without any table of translations to keep.
// Nothing the plugin ships imports this file.

import { vi } from 'vitest';

/** What the stand-in answers for a key in a language. */
export const marked = (language, key) => `⟦${language}:${key}⟧`;
export const en = (key) => marked('en', key);
export const pt = (key) => marked('pt', key);

/** Every marked text in a string; the key is the first group. */
export const MARK = /⟦[a-z]+:([^⟧]*)⟧/g;

/**
 * sdk.i18n as the Core hands it over. change(language) is the Core changing
 * language: translate() answers in the new one, then the listeners are told,
 * handed nothing.
 */
export function fakeI18n(language = 'en') {
  let current = language;
  const listeners = new Set();
  return {
    listeners,
    translate: vi.fn((key) => marked(current, key)),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    change(next) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
