// The plugin and the application's translations (sdk.i18n), on every surface
// the plugin draws: the two pages and the two Computer Details contributions.
//
// Text comes from sdk.i18n.translate. A change of language reaches a mounted
// surface through sdk.i18n.subscribe and nothing else: no unmount, no mount,
// no new SDK, no request - and what the user typed is still there.
//
// The stand-in for sdk.i18n holds no words: it answers ⟦en:key⟧, and
// ⟦pt:key⟧ after a change (testing/i18n.js).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as actionModule from './extensions/computer-todo-action.js';
import * as tabModule from './extensions/computer-todo-tab.js';
import { mount, unmount } from './todo-app.js';
import { en, fakeI18n, pt } from './testing/i18n.js';
import { fakeSdk, settle } from './testing/sdk.js';

const TODOS = [
  { id: 2, title: 'Replace the disk', computer_id: 42 },
  { id: 1, title: 'Buy milk' },
];
const LISTS = [{ id: 7, name: 'New Employee Setup', items: ['Create account', 'Assign laptop'] }];

let host;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  document.body.replaceChildren();
});

const $ = (selector) => host.shadowRoot.querySelector(selector);
const $$ = (selector) => [...host.shadowRoot.querySelectorAll(selector)];
const textOf = (selector) => $$(selector).map((node) => node.textContent.trim());
const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true }));
const listRequests = (sdk) => sdk.api.get.mock.calls.filter(([path]) => path !== '/me').length;
/** The first button a selector finds that shows the text of `key`. */
const button = (selector, key) => $(`${selector}[data-i18n="${key}"]`);

describe('the SDK contract', () => {
  it('a page refuses an SDK without sdk.i18n', () => {
    const { api } = fakeSdk();
    expect(() => mount(host, { sdk: { api }, path: '' })).toThrow(/sdk\.i18n\.translate, sdk\.i18n\.subscribe/);
    expect(() => mount(host, { sdk: { api, i18n: { translate: () => '' } }, path: '' })).toThrow(/sdk\.i18n\.subscribe/);
  });

  it('a page that refused left nothing behind', () => {
    const { api } = fakeSdk();
    expect(() => mount(host, { sdk: { api }, path: '' })).toThrow();
    expect(host.shadowRoot).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each([
    ['ComputerTodoAction', actionModule],
    ['ComputerTodoTab', tabModule],
  ])('%s refuses an SDK without sdk.i18n', (name, module) => {
    const { api, notify } = fakeSdk();
    expect(() => module.mount(host, { computerId: 42 }, { api, notify })).toThrow(/sdk\.i18n\.translate/);
  });

  it('a page uses the translate and subscribe it was handed, once subscribed per mount', async () => {
    const i18n = fakeI18n();
    mount(host, { sdk: fakeSdk({ i18n, todos: TODOS }), path: '' });
    await settle();

    expect(i18n.translate).toHaveBeenCalledWith('todo.title');
    expect(i18n.subscribe).toHaveBeenCalledTimes(1);
    expect(typeof i18n.subscribe.mock.calls[0][0]).toBe('function');
    unmount(host);
  });

  it('asks for nothing but translations by key: no request for them, through sdk.api or otherwise', async () => {
    const sdk = fakeSdk({ todos: TODOS });
    mount(host, { sdk, path: '' });
    await settle();
    sdk.i18n.change('pt');
    await settle();

    const asked = [...sdk.api.get.mock.calls, ...sdk.api.post.mock.calls].map(([path]) => path);
    expect(asked.filter((path) => /translat|language|locale|i18n/i.test(path))).toEqual([]);
    expect(asked.every((path) => path === '/me' || path.startsWith('/todos'))).toBe(true);
    unmount(host);
  });
});

describe('the To do List page', () => {
  it('shows its text through sdk.i18n, by key', async () => {
    mount(host, { sdk: fakeSdk({ todos: TODOS }), path: '' });
    await settle();

    expect($('h1').textContent).toBe(en('todo.title'));
    expect($('.new-title').getAttribute('placeholder')).toBe(en('todo.new-todo-placeholder'));
    expect($('.add-form button').textContent).toBe(en('todo.add'));
    expect($('.who').textContent).toBe(`${en('todo.signed-in-as')} alice`);
    expect(textOf('li .tag')).toEqual([`${en('todo.computer')} 42`]);
    expect(textOf('li button')).toEqual([en('todo.edit'), en('todo.delete'), en('todo.edit'), en('todo.delete')]);
    unmount(host);
  });

  it('follows a change of language without a new mount, and keeps what the user was doing', async () => {
    const sdk = fakeSdk({ todos: TODOS });
    mount(host, { sdk, path: '' });
    await settle();

    // The user has typed a new todo and is halfway through renaming another.
    $('.new-title').value = 'Call IT';
    button('li button', 'todo.edit').click();
    await settle();
    $('li input[type=text]').value = 'Replace both disks';

    const before = {
      main: $('main'),
      heading: $('h1'),
      input: $('.new-title'),
      editing: $('li input[type=text]'),
      rows: $$('li'),
      requests: listRequests(sdk),
    };

    sdk.i18n.change('pt');

    expect($('h1').textContent).toBe(pt('todo.title'));
    expect($('.new-title').getAttribute('placeholder')).toBe(pt('todo.new-todo-placeholder'));
    expect($('.add-form button').textContent).toBe(pt('todo.add'));
    expect($('.who').textContent).toBe(`${pt('todo.signed-in-as')} alice`);
    expect(textOf('li button')).toEqual([pt('todo.save'), pt('todo.delete'), pt('todo.edit'), pt('todo.delete')]);

    // The same elements, holding what they held.
    expect($('main')).toBe(before.main);
    expect($('h1')).toBe(before.heading);
    expect($('.new-title')).toBe(before.input);
    expect($('li input[type=text]')).toBe(before.editing);
    expect($$('li')).toEqual(before.rows);
    expect($('.new-title').value).toBe('Call IT');
    expect($('li input[type=text]').value).toBe('Replace both disks');

    // Nothing was asked of the server again, and the SDK is the one it was.
    expect(listRequests(sdk)).toBe(before.requests);
    expect(sdk.i18n.subscribe).toHaveBeenCalledTimes(1);
    unmount(host);
  });

  it('keeps data as it is: titles, names and ids are never asked for as keys', async () => {
    const sdk = fakeSdk({ todos: TODOS });
    mount(host, { sdk, path: '' });
    await settle();
    sdk.i18n.change('pt');

    expect(textOf('li .title')).toEqual(['Replace the disk', 'Buy milk']);
    expect(textOf('li .tag')).toEqual([`${pt('todo.computer')} 42`]);
    for (const [key] of sdk.i18n.translate.mock.calls) expect(key).toMatch(/^todo\.[a-z0-9]+(-[a-z0-9]+)*$/);
    unmount(host);
  });

  it('still works after a change of language', async () => {
    const sdk = fakeSdk({ todos: TODOS });
    mount(host, { sdk, path: '' });
    await settle();
    sdk.i18n.change('pt');

    $('.new-title').value = 'Call IT';
    submit($('.add-form'));
    await settle();

    expect(sdk.api.post).toHaveBeenCalledWith('/todos', { title: 'Call IT' });
    expect(textOf('li .title')).toEqual(['Call IT', 'Replace the disk', 'Buy milk']);
    // What was drawn after the change is in the language of the moment.
    expect(textOf('li button').slice(0, 2)).toEqual([pt('todo.edit'), pt('todo.delete')]);
    unmount(host);
  });

  it('says a list is empty, and that a user may only read, in the language of the moment', async () => {
    const sdk = fakeSdk({ canWrite: false });
    mount(host, { sdk, path: '' });
    await settle();

    expect($('.empty').textContent).toBe(en('todo.no-todos'));
    expect($('.who').textContent).toBe(`${en('todo.signed-in-as')} alice - ${en('todo.read-only-suffix')}`);

    sdk.i18n.change('pt');

    expect($('.empty').textContent).toBe(pt('todo.no-todos'));
    expect($('.who').textContent).toBe(`${pt('todo.signed-in-as')} alice - ${pt('todo.read-only-suffix')}`);
    expect($('.add-form').hidden).toBe(true);
    unmount(host);
  });

  it('shows an error of the API as the SDK worded it, in any language', async () => {
    const sdk = fakeSdk({ todos: TODOS });
    sdk.api.post.mockRejectedValueOnce(new Error('Server said no'));
    mount(host, { sdk, path: '' });
    await settle();
    $('.new-title').value = 'Call IT';
    submit($('.add-form'));
    await settle();

    sdk.i18n.change('pt');

    expect($('.error').hidden).toBe(false);
    expect($('.error').textContent).toBe('Server said no');
    expect($('.new-title').value).toBe('Call IT');
    expect(sdk.i18n.translate).not.toHaveBeenCalledWith('Server said no');
    unmount(host);
  });

  it('stops listening on unmount', async () => {
    const i18n = fakeI18n();
    mount(host, { sdk: fakeSdk({ i18n, todos: TODOS }), path: '' });
    await settle();
    expect(i18n.listeners.size).toBe(1);

    unmount(host);

    expect(i18n.listeners.size).toBe(0);
    expect(() => i18n.change('pt')).not.toThrow();
    expect(host.shadowRoot.childNodes.length).toBe(0);
  });

  it('listens once after mount, unmount, mount on the same element', async () => {
    const i18n = fakeI18n();
    mount(host, { sdk: fakeSdk({ i18n }), path: '' });
    mount(host, { sdk: fakeSdk({ i18n }), path: '' });
    await settle();
    expect(i18n.listeners.size).toBe(1);
    unmount(host);
  });
});

describe('the Predefined to do lists page', () => {
  it('shows its text through sdk.i18n, by key', async () => {
    mount(host, { sdk: fakeSdk({ lists: LISTS }), path: '/predefined' });
    await settle();

    expect($('h1').textContent).toBe(en('todo.predefined-title'));
    expect($('.new-name').getAttribute('placeholder')).toBe(en('todo.list-name-placeholder'));
    expect($('.new-items').getAttribute('placeholder')).toBe(en('todo.list-items-placeholder'));
    expect($('.template-form button').textContent).toBe(en('todo.add-list'));
    expect($('.who').textContent).toBe(`${en('todo.signed-in-as')} alice`);
    expect(textOf('li.template .head button')).toEqual([en('todo.edit'), en('todo.delete')]);
    unmount(host);
  });

  it('follows a change of language without a new mount, and keeps what the user was doing', async () => {
    const sdk = fakeSdk({ lists: LISTS });
    mount(host, { sdk, path: '/predefined' });
    await settle();

    $('.new-name').value = 'Offboarding';
    $('.new-items').value = 'Collect laptop\nClose account';
    button('.head button', 'todo.edit').click();
    await settle();
    $('.edit-name').value = 'New Employee Setup (2026)';
    $('.edit-items').value = 'Create account\nAssign laptop\nConfigure email';

    const before = {
      main: $('main'),
      name: $('.new-name'),
      items: $('.new-items'),
      editName: $('.edit-name'),
      editItems: $('.edit-items'),
      requests: listRequests(sdk),
    };

    sdk.i18n.change('pt');

    expect($('h1').textContent).toBe(pt('todo.predefined-title'));
    expect($('.template-form button').textContent).toBe(pt('todo.add-list'));
    expect(textOf('li.template .actions button')).toEqual([pt('todo.save'), pt('todo.cancel')]);

    expect($('main')).toBe(before.main);
    expect($('.new-name')).toBe(before.name);
    expect($('.new-items')).toBe(before.items);
    expect($('.edit-name')).toBe(before.editName);
    expect($('.edit-items')).toBe(before.editItems);
    expect($('.new-name').value).toBe('Offboarding');
    expect($('.new-items').value).toBe('Collect laptop\nClose account');
    expect($('.edit-name').value).toBe('New Employee Setup (2026)');
    expect($('.edit-items').value).toBe('Create account\nAssign laptop\nConfigure email');
    expect(listRequests(sdk)).toBe(before.requests);
    unmount(host);
  });

  it('keeps data as it is: list names and items are not translated', async () => {
    const sdk = fakeSdk({ lists: LISTS });
    mount(host, { sdk, path: '/predefined' });
    await settle();
    sdk.i18n.change('pt');

    expect(textOf('li.template .title')).toEqual(['New Employee Setup']);
    expect(textOf('li.template .items li')).toEqual(['Create account', 'Assign laptop']);
    unmount(host);
  });

  it('says what is wrong with a list in the language of the moment', async () => {
    const sdk = fakeSdk({ lists: LISTS });
    mount(host, { sdk, path: '/predefined' });
    await settle();

    $('.new-name').value = 'Offboarding';
    $('.new-items').value = '   ';
    submit($('.template-form'));
    expect($('.error').hidden).toBe(false);
    expect($('.error').textContent).toBe(en('todo.list-items-required'));

    sdk.i18n.change('pt');

    expect($('.error').textContent).toBe(pt('todo.list-items-required'));
    expect($('.error').hidden).toBe(false);
    expect(sdk.api.post).not.toHaveBeenCalled();
    unmount(host);
  });

  it('refuses a list without a name while it is being edited', async () => {
    const sdk = fakeSdk({ lists: LISTS });
    mount(host, { sdk, path: '/predefined' });
    await settle();
    button('.head button', 'todo.edit').click();
    await settle();

    $('.edit-name').value = '  ';
    button('.actions button', 'todo.save').click();

    expect($('.error').textContent).toBe(en('todo.list-name-required'));
    expect(sdk.api.put).not.toHaveBeenCalled();
    unmount(host);
  });

  it('a message that was cleared does not come back with a change of language', async () => {
    const sdk = fakeSdk({ lists: LISTS });
    mount(host, { sdk, path: '/predefined' });
    await settle();
    $('.new-name').value = 'Offboarding';
    submit($('.template-form'));
    expect($('.error').hidden).toBe(false);

    $('.new-items').value = 'Collect laptop';
    submit($('.template-form'));
    await settle();
    expect($('.error').hidden).toBe(true);

    sdk.i18n.change('pt');

    expect($('.error').hidden).toBe(true);
    expect($('.error').textContent).toBe('');
    unmount(host);
  });

  it('says there are no lists, and stops listening on unmount', async () => {
    const i18n = fakeI18n();
    mount(host, { sdk: fakeSdk({ i18n }), path: '/predefined' });
    await settle();
    expect($('.empty').textContent).toBe(en('todo.no-predefined-lists'));
    expect(i18n.listeners.size).toBe(1);

    unmount(host);
    expect(i18n.listeners.size).toBe(0);
  });
});

describe('moving between the two pages', () => {
  it('each page listens while it is mounted, and only then', async () => {
    const i18n = fakeI18n('pt');
    mount(host, { sdk: fakeSdk({ i18n }), path: '' });
    await settle();
    expect($('h1').textContent).toBe(pt('todo.title'));

    // What the Core does on a change of sub-path.
    unmount(host);
    mount(host, { sdk: fakeSdk({ i18n }), path: '/predefined' });
    await settle();

    expect($('h1').textContent).toBe(pt('todo.predefined-title'));
    expect(i18n.listeners.size).toBe(1);
    unmount(host);
    expect(i18n.listeners.size).toBe(0);
  });
});

describe('the To do tab on Computer Details', () => {
  it('shows its text through sdk.i18n, by key', async () => {
    const handle = tabModule.mount(host, { computerId: 42 }, fakeSdk({ canWrite: false }));
    await settle();

    expect($('h1')).toBeNull();
    expect($('.new-title').getAttribute('placeholder')).toBe(en('todo.new-computer-todo-placeholder'));
    expect($('.who').textContent).toBe(en('todo.read-only'));
    expect($('.empty').textContent).toBe(en('todo.no-computer-todos'));
    handle.unmount();
  });

  it('follows a change of language with neither update() nor mount()', async () => {
    const sdk = fakeSdk({ todos: TODOS, canWrite: false });
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();
    const main = $('main');
    const requests = listRequests(sdk);

    sdk.i18n.change('pt');

    expect($('.who').textContent).toBe(pt('todo.read-only'));
    expect($('main')).toBe(main);
    expect(textOf('li .title')).toEqual(['Replace the disk']);
    expect(listRequests(sdk)).toBe(requests);
    handle.unmount();
  });

  it('keeps what the user typed', async () => {
    const sdk = fakeSdk({ todos: TODOS });
    const handle = tabModule.mount(host, { computerId: 42 }, sdk);
    await settle();
    const input = $('.new-title');
    input.value = 'Check the fan';

    sdk.i18n.change('pt');

    expect($('.new-title')).toBe(input);
    expect(input.value).toBe('Check the fan');
    expect($('.add-form button').textContent).toBe(pt('todo.add'));
    handle.unmount();
  });

  it('says there is no computer in the language of the moment', () => {
    const sdk = fakeSdk();
    const handle = tabModule.mount(host, {}, sdk);
    expect($('.empty').textContent).toBe(en('todo.no-computer'));

    sdk.i18n.change('pt');

    expect($('.empty').textContent).toBe(pt('todo.no-computer'));
    handle.unmount();
    expect(sdk.i18n.listeners.size).toBe(0);
  });

  it('stops listening on unmount, and listens once when a new computer draws it again', async () => {
    const i18n = fakeI18n();
    const handle = tabModule.mount(host, { computerId: 42 }, fakeSdk({ i18n }));
    await settle();
    expect(i18n.listeners.size).toBe(1);

    handle.update({ computerId: 43 });
    await settle();
    expect(i18n.listeners.size).toBe(1);

    handle.update({});
    expect(i18n.listeners.size).toBe(1);

    handle.unmount();
    expect(i18n.listeners.size).toBe(0);
    expect(() => i18n.change('pt')).not.toThrow();
  });
});

describe('the Add Todo action on Computer Details', () => {
  it('shows its text through sdk.i18n, by key', () => {
    const handle = actionModule.mount(host, { computerId: 42 }, fakeSdk());

    expect($('.open').textContent.trim()).toBe(en('todo.add-todo'));
    expect($('.open').getAttribute('title')).toBe(en('todo.add-computer-todo-tooltip'));
    expect($('h2').textContent).toBe(en('todo.add-computer-todo-title'));
    expect($('.new-title').getAttribute('placeholder')).toBe(en('todo.new-todo-placeholder'));
    expect($('.cancel').textContent).toBe(en('todo.cancel'));
    expect($('.save').textContent).toBe(en('todo.add'));
    handle.unmount();
  });

  it('follows a change of language with the dialog open, and keeps what the user typed', () => {
    const sdk = fakeSdk();
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);
    $('.open').click();
    const dialog = $('dialog');
    const input = $('.new-title');
    input.value = 'Replace the disk';

    sdk.i18n.change('pt');

    expect($('.open').textContent.trim()).toBe(pt('todo.add-todo'));
    expect($('.cancel').textContent).toBe(pt('todo.cancel'));
    expect($('.save').textContent).toBe(pt('todo.add'));
    expect($('dialog')).toBe(dialog);
    expect(dialog.open).toBe(true);
    expect($('.new-title')).toBe(input);
    expect(input.value).toBe('Replace the disk');
    // The icon beside the words is still there.
    expect($('.open svg')).not.toBeNull();
    handle.unmount();
  });

  it('tells the Core of a new todo in the language of the moment', async () => {
    const sdk = fakeSdk();
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);
    sdk.i18n.change('pt');

    $('.open').click();
    $('.new-title').value = 'Replace the disk';
    submit($('form'));
    await settle();

    expect(sdk.notify).toHaveBeenCalledWith({ type: 'success', message: pt('todo.computer-todo-added') });
    handle.unmount();
  });

  it('stops listening on unmount, and listens to nothing when it renders nothing', () => {
    const i18n = fakeI18n();
    const handle = actionModule.mount(host, { computerId: 42 }, fakeSdk({ i18n }));
    expect(i18n.listeners.size).toBe(1);
    handle.unmount();
    expect(i18n.listeners.size).toBe(0);

    const none = actionModule.mount(host, {}, fakeSdk({ i18n }));
    expect(i18n.listeners.size).toBe(0);
    none.unmount();
  });
});
