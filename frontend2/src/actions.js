/** Action keys declared in the plugin manifest and enforced by the backend. */
export const ACTIONS = Object.freeze({
  TODO_VIEW: 'todo.view',
  TODO_CREATE: 'todo.create',
  TODO_UPDATE: 'todo.update',
  TODO_DELETE: 'todo.delete',
  PREDEFINED_VIEW: 'predefined.view',
  PREDEFINED_CREATE: 'predefined.create',
  PREDEFINED_UPDATE: 'predefined.update',
  PREDEFINED_DELETE: 'predefined.delete',
});

/**
 * Check a granular action. `canWrite` is a rollout fallback for older Core
 * responses that do not include the delegated `actions` list yet.
 */
export function hasAction(identity, action) {
  if (Array.isArray(identity?.actions)) return identity.actions.includes(action);
  return Boolean(identity?.canWrite);
}
