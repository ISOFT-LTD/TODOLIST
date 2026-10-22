"""FastAPI dependencies over a TokenVerifier.

    identity = require_identity(verifier)
    can_read = require_permission(verifier, "documents-api.documents.read")

    @app.get("/documents", dependencies=[Depends(can_read)])
    def list_documents(who: DelegatedIdentity = Depends(identity)): ...

Both read ``Authorization: Bearer <token>`` and nothing else - not a cookie,
not a query parameter, not an ``X-User-*`` header. A service that accepted
any of those would be accepting an identity the caller asserted rather than
one Core signed, which is the failure this whole contract exists to prevent.

A refused token is a 401 with ``WWW-Authenticate: Bearer error="..."`` and a
generic body; the reason is logged, not returned. A valid token lacking a
permission is a 403. ``request.state.identity`` carries the verified identity
for anything downstream that wants it without redeclaring the dependency.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

from fastapi import Depends, HTTPException, Request

from .claims import DelegatedIdentity
from .verifier import TokenVerifier, VerificationError

logger = logging.getLogger("cobalt_identity")


def bearer_token(request: Request) -> Optional[str]:
    header = request.headers.get("authorization") or ""
    scheme, _, credential = header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    credential = credential.strip()
    return credential or None


def _unauthorized(code: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": f'Bearer error="{code}"'},
    )


def require_identity(verifier: TokenVerifier) -> Callable[[Request], DelegatedIdentity]:
    """A dependency that yields the verified DelegatedIdentity or answers 401."""

    def dependency(request: Request) -> DelegatedIdentity:
        cached = getattr(request.state, "identity", None)
        if isinstance(cached, DelegatedIdentity):
            return cached

        token = bearer_token(request)
        if token is None:
            raise _unauthorized("invalid_request")
        try:
            identity = verifier.verify(token)
        except VerificationError as exc:
            logger.warning("delegated token refused on %s %s: %s",
                           request.method, request.url.path, exc.code)
            raise _unauthorized("invalid_token") from exc

        request.state.identity = identity
        return identity

    dependency.__name__ = "require_identity"
    return dependency


def require_permission(
    verifier: TokenVerifier, *names: str, any_of: bool = False,
) -> Callable[..., DelegatedIdentity]:
    """A dependency that also demands permissions (all of them, or any)."""
    if not names:
        raise ValueError("require_permission needs at least one permission name")
    identity_dependency = require_identity(verifier)

    def dependency(identity: DelegatedIdentity = Depends(identity_dependency)) -> DelegatedIdentity:
        allowed = identity.has_any(names) if any_of else identity.has_all(names)
        if not allowed:
            logger.warning("subject %s lacks %s for audience %s",
                           identity.subject, ", ".join(names), identity.audience)
            raise HTTPException(status_code=403, detail="Insufficient permission")
        return identity

    dependency.__name__ = "require_permission"
    return dependency
