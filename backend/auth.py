"""Who is calling: Cobalt Core's delegated identity, and nothing else.

Every request that reaches this service comes from Cobalt Core, server to
server, through Core's /apps proxy. Core checks the user's session, mints a
short-lived JWT for exactly this audience, and sends it as
``Authorization: Bearer``. This module verifies that token locally - signature
against Core's published keys, issuer, exact audience, tenant, expiry, and a
one-time token id - and trusts nothing else: not a cookie, not a query
parameter, not an ``X-User-*`` header. A service that accepted any of those
would be trusting what the caller claimed rather than what Core signed.

Configuration, from the environment:

    COBALT_AUDIENCE        this app's key in Core's registry            [todo]
    COBALT_ISSUER          Core's CORE_JWT_ISSUER                        [cobalt-core]
    COBALT_TENANT_ID       Core's CORE_TENANT_ID; unset accepts any tenant
    COBALT_CORE_JWKS_URL   Core's GET /auth/.well-known/jwks.json
    COBALT_CORE_JWKS_FILE  a saved copy of that document, used instead of the URL

One key source is required. Without either the service refuses to start: a
service that cannot verify Core's identity must not serve anyone.

ACTIONS. pulsar.yaml declares eight actions, each on the tab of the page it
belongs to. An administrator sets each one per role to ALLOW, DENY or
REQUIRE_APPROVAL, and Core puts the caller's decisions in the token, keyed
without the app's id: ``{"action_permissions": {"todo.create": "ALLOW"}}``.
Every data route checks its own action, and only that: the tab is Core's
coarse gate, checked before the call ever gets here.

    ALLOW               the route runs
    REQUIRE_APPROVAL    202 with Core's challenge, before anything changes;
                        Core stores the request and, once an administrator
                        approves it, sends the same call again with the
                        action ALLOW and the claim approval_request_id
    DENY, or nothing    403

The vendored cobalt_identity predates actions and is never edited here, so the
decisions are read from the verified claims (``identity.raw``).
"""

import json
import logging
import os
from collections.abc import Mapping
from typing import Dict, Optional

from cobalt_identity import (
    DelegatedIdentity,
    JwksUrl,
    ReplayCache,
    StaticKeys,
    TokenVerifier,
)
from cobalt_identity.fastapi_deps import require_identity
from fastapi import Depends, HTTPException, status

logger = logging.getLogger(__name__)

AUDIENCE = os.getenv("COBALT_AUDIENCE", "todo")
ISSUER = os.getenv("COBALT_ISSUER", "cobalt-core")
TENANT = os.getenv("COBALT_TENANT_ID") or None

# The actions pulsar.yaml declares. One set of names everywhere: the routes, the
# UI (frontend/src/actions.js), dev/fake_core.py and the tests.
READ_TODO = "todo.view"
ADD_TODO = "todo.create"
UPDATE_TODO = "todo.update"
DELETE_TODO = "todo.delete"
READ_PREDEFINED_LIST = "predefined.view"
ADD_PREDEFINED_LIST = "predefined.create"
UPDATE_PREDEFINED_LIST = "predefined.update"
DELETE_PREDEFINED_LIST = "predefined.delete"
ACTIONS = (
    READ_TODO, ADD_TODO, UPDATE_TODO, DELETE_TODO,
    READ_PREDEFINED_LIST, ADD_PREDEFINED_LIST, UPDATE_PREDEFINED_LIST, DELETE_PREDEFINED_LIST,
)
VIEW_ACTIONS = frozenset({READ_TODO, READ_PREDEFINED_LIST})

ALLOW = "ALLOW"
DENY = "DENY"
REQUIRE_APPROVAL = "REQUIRE_APPROVAL"
DECISIONS = frozenset({ALLOW, DENY, REQUIRE_APPROVAL})

# Core answers 502 to a 202 that is not exactly this challenge.
APPROVAL_REQUIRED_HEADER = "X-Cobalt-Approval-Required"
APPROVAL_ACTION_HEADER = "X-Cobalt-Approval-Action"
APPROVAL_MESSAGE = "Approval required"


def _key_source():
    """Core's public keys: a saved JWKS file, or Core's JWKS URL.

    The URL is cached and refreshed when a token names a key id it has not
    seen, which is how Core's key rotation reaches this service. The file never
    refreshes: after Core rotates its key, fetch it again.
    """
    jwks_file = os.getenv("COBALT_CORE_JWKS_FILE")
    if jwks_file:
        with open(jwks_file, "r", encoding="utf-8") as handle:
            return StaticKeys(jwks=json.load(handle))
    jwks_url = os.getenv("COBALT_CORE_JWKS_URL")
    if jwks_url:
        return JwksUrl(jwks_url)
    raise RuntimeError(
        "Cannot verify Cobalt Core's identity: set COBALT_CORE_JWKS_URL to Core's "
        "/auth/.well-known/jwks.json, or COBALT_CORE_JWKS_FILE to a saved copy of it."
    )


verifier = TokenVerifier(
    issuer=ISSUER,
    audience=AUDIENCE,
    keys=_key_source(),
    expected_tenant=TENANT,
    # Refuses a token id seen before. Per process, which is enough here: the
    # service runs exactly one worker (see the Dockerfile).
    replay_store=ReplayCache(),
)

# Verifies the token once per request, however many dependencies use it:
# require_identity caches the identity on request.state.
identity = require_identity(verifier)


def action_permissions(who: DelegatedIdentity) -> Dict[str, str]:
    """Core's decision on each of this app's actions, from the verified token.

    Anything but an object of the three decisions counts as no decision, which
    is a refusal: a malformed claim never grants anything.
    """
    value = getattr(who, "action_permissions", None)
    if value is None:
        value = who.raw.get("action_permissions")
    if not isinstance(value, Mapping):
        return {}
    return {
        key: decision for key, decision in value.items()
        if isinstance(key, str) and isinstance(decision, str) and decision in DECISIONS
    }


def approval_of(who: DelegatedIdentity, action: str) -> Optional[str]:
    """The approval request this call carries out, when Core replays an approved ``action``.

    Core sends an approved call again with the claims ``approved_action`` (the
    app's own key) and ``approval_request_id``. A write keys itself by that id,
    so receiving the same approval twice changes nothing more.
    """
    request_id = who.raw.get("approval_request_id")
    if who.raw.get("approved_action") != action or request_id in (None, ""):
        return None
    return str(request_id)


def require_action(action: str):
    """A dependency that lets a route run only on Core's ALLOW for ``action``.

    It runs before the route's body, so a REQUIRE_APPROVAL or a refusal changes
    nothing. It yields the verified identity.
    """
    if action not in ACTIONS:
        raise ValueError(f"{action!r} is not one of the actions pulsar.yaml declares")

    def checker(who: DelegatedIdentity = Depends(identity)) -> DelegatedIdentity:
        decision = action_permissions(who).get(action)
        if decision == ALLOW:
            return who
        if decision == REQUIRE_APPROVAL:
            # A challenge to Core's /apps proxy, never shown as it is: Core
            # stores the request and answers the browser 202 PENDING.
            raise HTTPException(
                status_code=status.HTTP_202_ACCEPTED,
                detail={"status": REQUIRE_APPROVAL, "action_key": action,
                        "message": APPROVAL_MESSAGE},
                headers={APPROVAL_REQUIRED_HEADER: "true", APPROVAL_ACTION_HEADER: action},
            )
        logger.warning("subject %s refused %s for audience %s (%s)",
                       who.subject, action, who.audience, decision or "no decision")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"message": "Action denied", "action_key": action, "status": DENY},
        )

    checker.__name__ = f"require_{action.replace('.', '_')}"
    return checker


def owner_of(who) -> tuple:
    """Whose data a request touches: Core's tenant and the user's stable id.

    Both opaque strings. ``sub`` is Core's user id and never changes for a
    person; the username is display only and must never key data.
    """
    return (who.tenant_id or "", who.subject)
