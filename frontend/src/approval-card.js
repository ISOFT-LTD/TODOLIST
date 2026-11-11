/** Return a normalized pending approval, or null for a normal API response. */
export function pendingApproval(response) {
  const detail = response?.detail;
  if (!detail || detail.status !== 'PENDING' || detail.approval_request_id == null) {
    return null;
  }
  return {
    message: String(detail.message || 'Approval required'),
    requestId: String(detail.approval_request_id),
    actionKey: String(detail.action_key || ''),
    status: String(detail.status),
  };
}

/** Populate an existing approval card. True means normal success must stop. */
export function showPendingApproval(card, response) {
  const approval = pendingApproval(response);
  if (!approval) return false;

  card.querySelector('.approval-message').textContent = approval.message;
  card.querySelector('.approval-id').textContent = `#${approval.requestId}`;
  card.querySelector('.approval-action').textContent = approval.actionKey;
  card.querySelector('.approval-status').textContent = approval.status;
  card.hidden = false;
  return true;
}

export function hidePendingApproval(card) {
  card.hidden = true;
}
