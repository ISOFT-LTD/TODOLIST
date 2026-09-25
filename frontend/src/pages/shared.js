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
    return { canWrite: Boolean(me?.can_write), name: me?.username || '' };
  } catch {
    return null;
  }
}

/** The "Signed in as ..." line, or '' when there is nothing to say. */
export function describeUser(me) {
  if (!me?.name) return '';
  return `Signed in as ${me.name}${me.canWrite ? '' : ' - read only'}`;
}
