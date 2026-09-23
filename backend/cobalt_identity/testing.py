"""LocalIssuer: mint tokens in a service's own tests without Core.

    issuer = LocalIssuer()                       # fresh RS256 key
    verifier = issuer.verifier("documents-api")  # trusts only that key
    token = issuer.mint("42", "documents-api", permissions=["documents-api.documents.read"])

Because it builds claims with the same ``build_claims`` Core uses and signs
with the same ``sign_compact``, a token from LocalIssuer is shaped exactly
like one from Core. Negative cases (wrong audience, expired, tampered) are
one keyword away, so a service can prove it refuses them.
"""

from __future__ import annotations

import secrets
import time
from typing import Any, Dict, Iterable, Optional

from . import jws
from .claims import build_claims
from .verifier import StaticKeys, TokenVerifier


class LocalIssuer:
    def __init__(self, algorithm: str = "RS256", issuer: str = "cobalt-core",
                 client_id: str = "cobalt-core", tenant_id: Optional[str] = "test-tenant"):
        self.private_key = jws.generate_private_key(algorithm)
        self.kid = jws.thumbprint(self.private_key.public_key())
        self.issuer = issuer
        self.client_id = client_id
        self.tenant_id = tenant_id

    def jwks(self) -> Dict[str, Any]:
        return {"keys": [jws.public_jwk(self.private_key.public_key(), self.kid)]}

    def verifier(self, audience: str, **kwargs: Any) -> TokenVerifier:
        kwargs.setdefault("expected_tenant", self.tenant_id)
        return TokenVerifier(
            issuer=self.issuer, audience=audience, keys=StaticKeys(jwks=self.jwks()), **kwargs,
        )

    def claims(
        self,
        subject: str,
        audience: str,
        *,
        permissions: Iterable[str] = (),
        roles: Iterable[str] = (),
        username: Optional[str] = None,
        session_id: Optional[str] = "sid_test",
        lifetime_seconds: int = 180,
        issued_at: Optional[int] = None,
        **overrides: Any,
    ) -> Dict[str, Any]:
        claims = build_claims(
            issuer=self.issuer,
            subject=subject,
            audience=audience,
            client_id=self.client_id,
            token_id=secrets.token_urlsafe(16),
            issued_at=int(issued_at if issued_at is not None else time.time()),
            lifetime_seconds=lifetime_seconds,
            username=username,
            tenant_id=self.tenant_id,
            session_id=session_id,
            roles=roles,
            permissions=permissions,
        )
        claims.update(overrides)
        return claims

    def sign(self, claims: Dict[str, Any], *, kid: Optional[str] = None) -> str:
        return jws.sign_compact(claims, self.private_key, kid=kid or self.kid)

    def mint(self, subject: str, audience: str, **kwargs: Any) -> str:
        return self.sign(self.claims(subject, audience, **kwargs))
