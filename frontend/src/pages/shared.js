/**
 * What the pages share: appending their markup, and who is calling.
 */

/** Append markup to a root. A ShadowRoot has no insertAdjacentHTML. */
export function appendHtml(root, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  root.append(template.content);
}

/**
 * Who is calling, as the API reports it (GET /me), for a page to hide the
 * controls a read-only user cannot use - the service refuses those writes
 * anyway; this just saves a click that would fail.
 *
 * Resolves to null when the call fails: the list request that follows reports
 * anything that really is wrong.
 */
export async function whoIsCalling(api) {
  try {
    const me = await api.get('/me');
    return {
      actions: Array.isArray(me?.actions) ? me.actions : null,
      actionPermissions: (
        me?.action_permissions
        && typeof me.action_permissions === 'object'
        && !Array.isArray(me.action_permissions)
      ) ? { ...me.action_permissions } : null,
      canWrite: Boolean(me?.can_write),
      name: me?.username || '',
    };
  } catch {
    return null;
  }
}

/**
 * The "Signed in as ..." line, or '' when there is nothing to say. `t` gives
 * the words of the moment; the name is data and stays as it is.
 */
export function describeUser(me, t, canWrite = me?.canWrite) {
  if (!me?.name) return '';
  const signedIn = `${t('todo.signed-in-as')} ${me.name}`;
  return canWrite ? signedIn : `${signedIn} - ${t('todo.read-only-suffix')}`;
}
