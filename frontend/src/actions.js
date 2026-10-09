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

export const ACTION_DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
});

/**
 * Whether the UI should offer an action. Approval-gated actions stay visible
 * so invoking them can create an approval request. `actions` and `canWrite`
 * are rollout fallbacks for older identity responses.
 */
export function hasAction(identity, action) {
  const permissions = identity?.actionPermissions;
  if (permissions && typeof permissions === 'object') {
    const decision = permissions[action];
    return decision === ACTION_DECISIONS.ALLOW
      || decision === ACTION_DECISIONS.REQUIRE_APPROVAL;
  }
  if (Array.isArray(identity?.actions)) return identity.actions.includes(action);
  return Boolean(identity?.canWrite);
}
