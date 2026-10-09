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

ACTIONS. Core puts its decision for each action in the delegated token's
``action_permissions`` object. Every data route checks its own action name.
"""

import json
import os

from cobalt_identity import JwksUrl, ReplayCache, StaticKeys, TokenVerifier
from fastapi import Depends, HTTPException, status

from cobalt_identity import DelegatedIdentity
from cobalt_identity.fastapi_deps import require_identity

AUDIENCE = os.getenv("COBALT_AUDIENCE", "todo")
ISSUER = os.getenv("COBALT_ISSUER", "cobalt-core")
TENANT = os.getenv("COBALT_TENANT_ID") or None
READ_TODO = "todo.view"
ADD_TODO = "todo.create"
UPDATE_TODO = "todo.update"
DELETE_TODO = "todo.delete"
READ_PREDEFINED_LIST = "predefined.view"
ADD_PREDEFINED_LIST = "predefined.create"
UPDATE_PREDEFINED_LIST = "predefined.update"
DELETE_PREDEFINED_LIST = "predefined.delete"
APPROVAL_REQUIRED_HEADER = "X-Cobalt-Approval-Required"
APPROVAL_ACTION_HEADER = "X-Cobalt-Approval-Action"


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

# Dependencies. The token is verified once per request however many dependencies
# use it, because require_identity caches the result on request.state.
identity = require_identity(verifier)


def get_delegated_principal(
    principal: DelegatedIdentity = Depends(identity),
) -> DelegatedIdentity:
    """Return the identity and actions verified from Core's delegated JWT."""
    return principal


def require_delegated_action(action_key: str):
    """Require Core's explicit ALLOW decision for one route action."""

    def checker(
        principal: DelegatedIdentity = Depends(get_delegated_principal),
    ) -> DelegatedIdentity:
        decision = principal.action_permission(action_key)
        if decision == "REQUIRE_APPROVAL":
            # This is an internal challenge to Core's /apps proxy, not the
            # final browser response. Core validates it, creates the approval
            # record from the original request, and adds approval_request_id.
            raise HTTPException(
                status_code=status.HTTP_202_ACCEPTED,
                detail={
                    "message": "Approval required",
                    "action_key": action_key,
                    "status": decision,
                },
                headers={
                    APPROVAL_REQUIRED_HEADER: "true",
                    APPROVAL_ACTION_HEADER: action_key,
                },
            )
        if decision != "ALLOW":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "Action denied",
                    "action_key": action_key,
                    "status": "DENY",
                },
            )
        return principal

    checker.__name__ = f"require_{action_key.replace('.', '_')}"
    return checker


def owner_of(who) -> tuple:
    """Whose data a request touches: Core's tenant and the user's stable id.

    Both opaque strings. ``sub`` is Core's user id and never changes for a
    person; the username is display only and must never key data.
    """
    return (who.tenant_id or "", who.subject)
