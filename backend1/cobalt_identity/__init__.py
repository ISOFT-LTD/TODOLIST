"""cobalt-identity: verify delegated identity tokens minted by Cobalt Core.

The package is deliberately small and dependency-light (``cryptography``
only; FastAPI helpers are an optional import) so that any application
service can adopt it without inheriting Core's stack.

    jws           sign / verify compact JWS, JWK export and import, key ids
    claims        the DelegatedIdentity contract and its validation rules
    verifier      TokenVerifier: keys (static or JWKS URL), replay cache
    fastapi_deps  require_identity / require_permission dependencies
    testing       LocalIssuer, for a service's own test suite
"""

from .claims import ClaimError, DelegatedIdentity, validate_claims
from .jws import JWSError
from .verifier import JwksUrl, ReplayCache, StaticKeys, TokenVerifier, VerificationError

__all__ = [
    "ClaimError",
    "DelegatedIdentity",
    "JWSError",
    "JwksUrl",
    "ReplayCache",
    "StaticKeys",
    "TokenVerifier",
    "VerificationError",
    "validate_claims",
]

__version__ = "1.0.0"
