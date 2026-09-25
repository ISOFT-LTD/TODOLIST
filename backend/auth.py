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
    COBALT_PERMISSION_TAB  the Core tab this app's permissions hang off  [todo]

One key source is required. Without either the service refuses to start: a
service that cannot verify Core's identity must not serve anyone.

PERMISSIONS. Core names them ``<app_key>.<tab_key>.<action>``: a user with Read
on the ``todo`` tab gets ``todo.todo.read``; with All, also ``todo.todo.all``.
Reading needs the first, changing anything needs the second.
"""

import json
import os

from cobalt_identity import JwksUrl, ReplayCache, StaticKeys, TokenVerifier
from cobalt_identity.fastapi_deps import require_identity, require_permission

AUDIENCE = os.getenv("COBALT_AUDIENCE", "todo")
ISSUER = os.getenv("COBALT_ISSUER", "cobalt-core")
TENANT = os.getenv("COBALT_TENANT_ID") or None
PERMISSION_TAB = os.getenv("COBALT_PERMISSION_TAB", "todo")

CAN_READ = f"{AUDIENCE}.{PERMISSION_TAB}.read"
CAN_WRITE = f"{AUDIENCE}.{PERMISSION_TAB}.all"


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

# Dependencies. Each yields the verified DelegatedIdentity; the token is
# verified once per request however many of them a route uses.
identity = require_identity(verifier)
can_read = require_permission(verifier, CAN_READ)
can_write = require_permission(verifier, CAN_WRITE)


def owner_of(who) -> tuple:
    """Whose data a request touches: Core's tenant and the user's stable id.

    Both opaque strings. ``sub`` is Core's user id and never changes for a
    person; the username is display only and must never key data.
    """
    return (who.tenant_id or "", who.subject)
