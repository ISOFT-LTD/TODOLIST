// Core's actions in the UI: which controls a user is offered, and the pending
// approval Core answers with when an action needs one.

import { afterEach, describe, expect, it } from 'vitest';
import { ACTIONS, hasAction } from './actions.js';
import { pendingApproval } from './approval-card.js';
import * as actionModule from './extensions/computer-todo-action.js';
import { mountTodoList } from './pages/todo-list.js';
import { fakeI18n } from './testing/i18n.js';
import { fakeSdk, settle } from './testing/sdk.js';

/** Core's answer to the browser once it has stored an approval request. */
const PENDING = {
  detail: {
    status: 'PENDING',
    approval_request_id: 91,
    action_key: 'todo.todo.create',
    message: 'Approval request created',
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('hasAction', () => {
  const me = (decision) => ({ actionPermissions: { [ACTIONS.TODO_CREATE]: decision } });

  it('offers an action Core allows or sends for approval', () => {
    expect(hasAction(me('ALLOW'), ACTIONS.TODO_CREATE)).toBe(true);
    expect(hasAction(me('REQUIRE_APPROVAL'), ACTIONS.TODO_CREATE)).toBe(true);
  });

  it('hides an action Core denies, does not name, or names with anything else', () => {
    expect(hasAction(me('DENY'), ACTIONS.TODO_CREATE)).toBe(false);
    expect(hasAction(me('allow'), ACTIONS.TODO_CREATE)).toBe(false);
    expect(hasAction(me('ALLOW'), ACTIONS.TODO_DELETE)).toBe(false);
  });

  it('decisions win over the older fields', () => {
    expect(hasAction({ actionPermissions: {}, canWrite: true }, ACTIONS.TODO_CREATE)).toBe(false);
  });

  it('falls back to the allowed list, then to can_write, for an older /me', () => {
    expect(hasAction({ actions: ['todo.create'] }, ACTIONS.TODO_CREATE)).toBe(true);
    expect(hasAction({ actions: [], canWrite: true }, ACTIONS.TODO_CREATE)).toBe(false);
    expect(hasAction({ canWrite: true }, ACTIONS.TODO_CREATE)).toBe(true);
    expect(hasAction(null, ACTIONS.TODO_CREATE)).toBe(false);
  });
});

describe('pendingApproval', () => {
  it('reads Core\'s pending answer', () => {
    expect(pendingApproval(PENDING)).toEqual({
      message: 'Approval request created',
      requestId: '91',
      actionKey: 'todo.todo.create',
      status: 'PENDING',
    });
  });

  it('is null for a normal answer, and for the app\'s own challenge', () => {
    expect(pendingApproval({ id: 3, title: 'x' })).toBeNull();
    expect(pendingApproval(null)).toBeNull();
    expect(pendingApproval({ detail: { status: 'REQUIRE_APPROVAL', action_key: 'todo.create' } })).toBeNull();
    expect(pendingApproval({ detail: { status: 'PENDING' } })).toBeNull();
  });
});

describe('a page under Core\'s decisions', () => {
  function mountPage(options) {
    const sdk = fakeSdk({ todos: [{ id: 1, title: 'Buy milk' }], ...options });
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const destroy = mountTodoList(root, { api: sdk.api, i18n: fakeI18n() });
    return { sdk, root, destroy };
  }

  it('shows each control only for the action behind it', async () => {
    const { root, destroy } = mountPage({
      decisions: { 'todo.update': 'DENY', 'todo.delete': 'REQUIRE_APPROVAL' },
    });
    await settle();

    expect(root.querySelector('.add-form').hidden).toBe(false);
    expect(root.querySelector('li input[type=checkbox]').disabled).toBe(true);
    expect(root.querySelectorAll('li button')).toHaveLength(1);
    destroy();
  });

  it('a read-only user gets no form and no buttons', async () => {
    const { root, destroy } = mountPage({ canWrite: false });
    await settle();

    expect(root.querySelector('.add-form').hidden).toBe(true);
    expect(root.querySelectorAll('li button')).toHaveLength(0);
    destroy();
  });

  it('shows the pending approval and keeps what was typed', async () => {
    const { sdk, root, destroy } = mountPage({ decisions: { 'todo.create': 'REQUIRE_APPROVAL' } });
    sdk.api.post.mockResolvedValueOnce(PENDING);
    await settle();

    root.querySelector('.new-title').value = 'Order a disk';
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    const card = root.querySelector('.approval-card');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.approval-id').textContent).toBe('#91');
    expect(card.querySelector('.approval-action').textContent).toBe('todo.todo.create');
    expect(root.querySelector('.new-title').value).toBe('Order a disk');
    destroy();
  });
});

describe('the Add Todo action under Core\'s decisions', () => {
  it('shows a user whose todo.create needs approval the button, then the pending card', async () => {
    const sdk = fakeSdk({ decisions: { 'todo.create': 'REQUIRE_APPROVAL' } });
    sdk.api.post.mockResolvedValueOnce(PENDING);
    const host = document.createElement('div');
    document.body.append(host);
    const handle = actionModule.mount(host, { computerId: 42 }, sdk);
    await settle();

    const open = host.shadowRoot.querySelector('.open');
    expect(open.hidden).toBe(false);
    open.click();
    host.shadowRoot.querySelector('.new-title').value = 'Replace the disk';
    host.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(host.shadowRoot.querySelector('.approval-card').hidden).toBe(false);
    expect(host.shadowRoot.querySelector('dialog').open).toBe(true);
    expect(sdk.notify).not.toHaveBeenCalled();
    handle.unmount();
  });

  it('stays hidden from a user Core denies todo.create', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = actionModule.mount(
      host, { computerId: 42 }, fakeSdk({ decisions: { 'todo.create': 'DENY' } }),
    );
    await settle();

    expect(host.shadowRoot.querySelector('.open').hidden).toBe(true);
    handle.unmount();
  });
});
