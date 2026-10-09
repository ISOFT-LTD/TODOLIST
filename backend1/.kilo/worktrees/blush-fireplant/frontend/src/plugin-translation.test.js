// The plugin's translation helper over sdk.i18n: what every page and
// contribution shows its text through. The vanilla counterpart of the Core
// skeleton's usePluginTranslation().
//
// The helper holds no words and adds none: whatever sdk.i18n.translate
// answers for a key is what is shown, the raw key included.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginTranslation, missingI18n } from './plugin-translation.js';
import { en, fakeI18n, pt } from './testing/i18n.js';

/** An SDK that answers as `answer` says, and never reports a change. */
const answering = (answer) => ({ translate: vi.fn(answer), subscribe: vi.fn(() => () => {}) });

let root;

beforeEach(() => {
  const host = document.createElement('div');
  document.body.append(host);
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <h1 data-i18n="todo.title"></h1>
    <input class="new" data-i18n-placeholder="todo.new-todo-placeholder">
    <button class="open" data-i18n-title="todo.add-computer-todo-tooltip" data-i18n-aria-label="todo.add"></button>
    <ul></ul>
  `;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('t', () => {
  it('answers with what sdk.i18n.translate answers for the key', () => {
    const { t, stop } = createPluginTranslation(fakeI18n(), root);
    expect(t('todo.add')).toBe(en('todo.add'));
    stop();
  });

  it('asks sdk.i18n.translate with the key as it was written', () => {
    const i18n = fakeI18n();
    const { t, stop } = createPluginTranslation(i18n, root);
    i18n.translate.mockClear();
    t('todo.add');
    expect(i18n.translate).toHaveBeenCalledTimes(1);
    expect(i18n.translate).toHaveBeenCalledWith('todo.add');
    stop();
  });

  it('answers in the new language after a change', () => {
    const i18n = fakeI18n();
    const { t, stop } = createPluginTranslation(i18n, root);
    i18n.change('pt');
    expect(t('todo.add')).toBe(pt('todo.add'));
    stop();
  });
});

describe('no words of its own', () => {
  it('shows the raw key when that is what the Core answers: a missing translation stays visible', () => {
    const { t, stop } = createPluginTranslation(answering((key) => key), root);
    expect(t('todo.add')).toBe('todo.add');
    expect(root.querySelector('h1').textContent).toBe('todo.title');
    expect(root.querySelector('.new').getAttribute('placeholder')).toBe('todo.new-todo-placeholder');
    stop();
  });

  it('puts nothing in the place of an empty answer', () => {
    const { t, stop } = createPluginTranslation(answering(() => ''), root);
    expect(t('todo.add')).toBe('');
    expect(root.querySelector('h1').textContent).toBe('');
    stop();
  });
});

describe('markup', () => {
  it('draws the text and the attributes the markup names by key', () => {
    const { stop } = createPluginTranslation(fakeI18n(), root);
    expect(root.querySelector('h1').textContent).toBe(en('todo.title'));
    expect(root.querySelector('.new').getAttribute('placeholder')).toBe(en('todo.new-todo-placeholder'));
    expect(root.querySelector('.open').getAttribute('title')).toBe(en('todo.add-computer-todo-tooltip'));
    expect(root.querySelector('.open').getAttribute('aria-label')).toBe(en('todo.add'));
    stop();
  });

  it('follows a change of language, in the elements that were there', () => {
    const i18n = fakeI18n();
    const { stop } = createPluginTranslation(i18n, root);
    const heading = root.querySelector('h1');
    const input = root.querySelector('.new');
    input.value = 'typed by the user';

    i18n.change('pt');

    expect(root.querySelector('h1')).toBe(heading);
    expect(heading.textContent).toBe(pt('todo.title'));
    expect(root.querySelector('.new')).toBe(input);
    expect(input.getAttribute('placeholder')).toBe(pt('todo.new-todo-placeholder'));
    expect(input.value).toBe('typed by the user');
    expect(root.querySelector('.open').getAttribute('title')).toBe(pt('todo.add-computer-todo-tooltip'));
    stop();
  });
});

describe('elements made later', () => {
  it('text() gives an element its text, and keeps it in the language of the moment', () => {
    const i18n = fakeI18n();
    const { text, stop } = createPluginTranslation(i18n, root);
    const button = document.createElement('button');

    expect(text(button, 'todo.add')).toBe(button);
    expect(button.textContent).toBe(en('todo.add'));
    root.querySelector('ul').append(button);

    i18n.change('pt');
    expect(button.textContent).toBe(pt('todo.add'));
    stop();
  });

  it('attr() does the same for an attribute', () => {
    const i18n = fakeI18n();
    const { attr, stop } = createPluginTranslation(i18n, root);
    const input = document.createElement('input');

    expect(attr(input, 'placeholder', 'todo.new-todo-placeholder')).toBe(input);
    expect(input.getAttribute('placeholder')).toBe(en('todo.new-todo-placeholder'));
    root.append(input);

    i18n.change('pt');
    expect(input.getAttribute('placeholder')).toBe(pt('todo.new-todo-placeholder'));
    stop();
  });

  it('attr() refuses an attribute a change of language would not reach', () => {
    const { attr, stop } = createPluginTranslation(fakeI18n(), root);
    expect(() => attr(document.createElement('input'), 'value', 'todo.add')).toThrow(/value/);
    stop();
  });

  it('plain() shows data as it is, and a change of language leaves it alone', () => {
    const i18n = fakeI18n();
    const { text, plain, stop } = createPluginTranslation(i18n, root);
    const box = document.createElement('p');
    root.append(box);
    text(box, 'todo.add');

    expect(plain(box, 'Server said no')).toBe(box);
    expect(box.textContent).toBe('Server said no');

    i18n.change('pt');
    expect(box.textContent).toBe('Server said no');
    stop();
  });

  it('an element that left the page is no longer drawn, and holds nothing back', () => {
    const i18n = fakeI18n();
    const { text, stop } = createPluginTranslation(i18n, root);
    const button = text(document.createElement('button'), 'todo.add');
    root.querySelector('ul').append(button);
    root.querySelector('ul').replaceChildren();

    i18n.change('pt');
    expect(button.textContent).toBe(en('todo.add'));
    stop();
  });
});

describe('text composed with data', () => {
  it('onChange() draws it again after a change of language, not before', () => {
    const i18n = fakeI18n();
    const { t, onChange, stop } = createPluginTranslation(i18n, root);
    const who = document.createElement('p');
    const draw = vi.fn(() => {
      who.textContent = `${t('todo.signed-in-as')} alice`;
    });

    onChange(draw);
    expect(draw).not.toHaveBeenCalled();

    i18n.change('pt');
    expect(draw).toHaveBeenCalledTimes(1);
    expect(who.textContent).toBe(`${pt('todo.signed-in-as')} alice`);
    stop();
  });
});

describe('a translation is text, never markup', () => {
  it('shows what the translation database holds without reading it as HTML', () => {
    // The one place a test needs a particular value: what a hostile row would hold.
    const hostile = '<img src=x onerror="alert(1)">';
    const { text, attr, stop } = createPluginTranslation(answering(() => hostile), root);
    const heading = root.querySelector('h1');
    expect(heading.textContent).toBe(hostile);
    expect(heading.children.length).toBe(0);

    const made = text(document.createElement('button'), 'todo.add');
    expect(made.children.length).toBe(0);
    expect(attr(document.createElement('input'), 'placeholder', 'todo.add').getAttribute('placeholder')).toBe(hostile);
    expect(root.querySelector('img')).toBeNull();
    stop();
  });
});

describe('the subscription', () => {
  it('is one at the SDK, however many texts are shown', () => {
    const i18n = fakeI18n();
    const { text, onChange, stop } = createPluginTranslation(i18n, root);
    text(document.createElement('button'), 'todo.add');
    onChange(() => {});
    onChange(() => {});

    expect(i18n.subscribe).toHaveBeenCalledTimes(1);
    expect(i18n.listeners.size).toBe(1);
    stop();
  });

  it('ends with stop(), which is safe to repeat', () => {
    const i18n = fakeI18n();
    const { stop } = createPluginTranslation(i18n, root);
    stop();
    stop();
    expect(i18n.listeners.size).toBe(0);
  });

  it('draws nothing after stop(), even if the SDK still tells it', () => {
    const i18n = fakeI18n();
    const draw = vi.fn();
    // An SDK whose unsubscribe does nothing: the helper must not rely on it.
    i18n.subscribe.mockImplementation((listener) => {
      i18n.listeners.add(listener);
      return () => {};
    });
    const { onChange, stop } = createPluginTranslation(i18n, root);
    onChange(draw);
    stop();

    expect(() => i18n.change('pt')).not.toThrow();
    expect(draw).not.toHaveBeenCalled();
    expect(root.querySelector('h1').textContent).toBe(en('todo.title'));
  });
});

describe('missingI18n', () => {
  it('names what an SDK lacks of sdk.i18n', () => {
    expect(missingI18n({ i18n: fakeI18n() })).toEqual([]);
    expect(missingI18n({})).toEqual(['sdk.i18n.translate', 'sdk.i18n.subscribe']);
    expect(missingI18n({ i18n: { translate: () => '' } })).toEqual(['sdk.i18n.subscribe']);
    expect(missingI18n(undefined)).toEqual(['sdk.i18n.translate', 'sdk.i18n.subscribe']);
  });
});
