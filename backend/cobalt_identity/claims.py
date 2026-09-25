"""The delegated identity contract: which claims a token carries and what
each verifier must check before believing any of them.

Mirrors AUTHENTICATION_MICROSERVICE_ANALYSIS.md section 4.2::

    iss                 Core's issuer name (configured, not a URL by necessity)
    sub                 the stable Core user id, as a string; opaque to services
    aud                 exactly ONE registered application key
    azp                 the calling Core workload ("cobalt-core")
    preferred_username  display/context only, never a join key
    tenant_id           the deployment's tenant identifier
    roles               role names Core chose to disclose to THIS audience
    permissions         "<app_key>.<resource>.<action>" strings for THIS audience
    sid                 the browser session's non-secret public id
    authz_ver           a fingerprint of the grants the claims were built from
    iat / nbf / exp     seconds since the epoch; exp - iat is a few minutes
    jti                 unique per token, for replay detection

Every check here is a rule from section 4.2: signature (elsewhere), allowed
algorithm (elsewhere), issuer, exact audience, exp, nbf, subject, tenant,
and the shape of the required claims. A verifier that skips one is not
compliant; ``validate_claims`` is the shared implementation so none does.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, Iterable, Mapping, Optional, Tuple

REQUIRED_CLAIMS = ("iss", "sub", "aud", "exp", "iat", "jti")

# A token minted for a few minutes must not be accepted for a few days. The
# issuer decides the lifetime; the verifier bounds it, so a compromised or
# misconfigured issuer cannot hand out long-lived credentials unnoticed.
DEFAULT_MAX_LIFETIME_SECONDS = 600
DEFAULT_LEEWAY_SECONDS = 30


class ClaimError(ValueError):
    """The claims are well-formed JSON but violate the contract. ``code`` says how."""

    def __init__(self, code: str, message: Optional[str] = None):
        super().__init__(message or code)
        self.code = code


@dataclass(frozen=True)
class DelegatedIdentity:
    """A verified token, as the application sees it."""

    subject: str
    audience: str
    issuer: str
    username: Optional[str] = None
    tenant_id: Optional[str] = None
    client_id: Optional[str] = None
    session_id: Optional[str] = None
    token_id: Optional[str] = None
    authz_version: Optional[str] = None
    roles: Tuple[str, ...] = ()
    permissions: FrozenSet[str] = frozenset()
    issued_at: int = 0
    expires_at: int = 0
    not_before: Optional[int] = None
    raw: Mapping[str, Any] = field(default_factory=dict, compare=False, repr=False)

    def has_permission(self, name: str) -> bool:
        return name in self.permissions

    def has_all(self, names: Iterable[str]) -> bool:
        return all(name in self.permissions for name in names)

    def has_any(self, names: Iterable[str]) -> bool:
        return any(name in self.permissions for name in names)

    def has_role(self, name: str) -> bool:
        return name in self.roles


def _require_text(payload: Mapping[str, Any], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ClaimError(f"invalid_{name}", f"claim {name!r} must be a non-empty string")
    return value


def _optional_text(payload: Mapping[str, Any], name: str) -> Optional[str]:
    value = payload.get(name)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ClaimError(f"invalid_{name}", f"claim {name!r} must be a string")
    return value


def _require_time(payload: Mapping[str, Any], name: str, *, required: bool) -> Optional[int]:
    value = payload.get(name)
    if value is None:
        if required:
            raise ClaimError(f"missing_{name}", f"claim {name!r} is required")
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ClaimError(f"invalid_{name}", f"claim {name!r} must be a number of seconds")
    return int(value)


def _string_list(payload: Mapping[str, Any], name: str) -> Tuple[str, ...]:
    value = payload.get(name)
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ClaimError(f"invalid_{name}", f"claim {name!r} must be a list of strings")
    return tuple(value)


def audience_matches(claimed: Any, expected: str) -> bool:
    """Exact match. A string, or a list holding exactly that one value.

    A token naming several audiences is refused on purpose: section 4.2 says
    a delegated token is for ONE service, and a multi-audience token is how a
    token meant for Documents ends up accepted by Images.
    """
    if isinstance(claimed, str):
        return claimed == expected
    if isinstance(claimed, list):
        return len(claimed) == 1 and claimed[0] == expected
    return False


def validate_claims(
    payload: Mapping[str, Any],
    *,
    issuer: str,
    audience: str,
    now: float,
    leeway: int = DEFAULT_LEEWAY_SECONDS,
    expected_tenant: Optional[str] = None,
    max_lifetime: Optional[int] = DEFAULT_MAX_LIFETIME_SECONDS,
) -> DelegatedIdentity:
    """Apply the contract to an already signature-verified payload."""
    for name in REQUIRED_CLAIMS:
        if name not in payload:
            raise ClaimError(f"missing_{name}", f"claim {name!r} is required")

    claimed_issuer = _require_text(payload, "iss")
    if claimed_issuer != issuer:
        raise ClaimError("wrong_issuer", f"issuer {claimed_issuer!r} is not {issuer!r}")

    if not audience_matches(payload.get("aud"), audience):
        raise ClaimError("wrong_audience", f"token is not for {audience!r}")

    subject = _require_text(payload, "sub")
    token_id = _require_text(payload, "jti")

    issued_at = _require_time(payload, "iat", required=True)
    expires_at = _require_time(payload, "exp", required=True)
    not_before = _require_time(payload, "nbf", required=False)

    now = int(now)
    if now > expires_at + leeway:
        raise ClaimError("expired", "token has expired")
    if not_before is not None and now + leeway < not_before:
        raise ClaimError("not_yet_valid", "token is not valid yet")
    if issued_at > now + leeway:
        raise ClaimError("issued_in_future", "token claims to be issued in the future")
    if max_lifetime is not None and expires_at - issued_at > max_lifetime:
        raise ClaimError("lifetime_too_long",
                         f"token lifetime exceeds {max_lifetime}s")

    tenant = _optional_text(payload, "tenant_id")
    if expected_tenant is not None:
        if tenant != expected_tenant:
            raise ClaimError("wrong_tenant", "token is for a different tenant")

    return DelegatedIdentity(
        subject=subject,
        audience=audience,
        issuer=claimed_issuer,
        username=_optional_text(payload, "preferred_username"),
        tenant_id=tenant,
        client_id=_optional_text(payload, "azp"),
        session_id=_optional_text(payload, "sid"),
        token_id=token_id,
        authz_version=_optional_text(payload, "authz_ver"),
        roles=_string_list(payload, "roles"),
        permissions=frozenset(_string_list(payload, "permissions")),
        issued_at=issued_at,
        expires_at=expires_at,
        not_before=not_before,
        raw=dict(payload),
    )


def build_claims(
    *,
    issuer: str,
    subject: str,
    audience: str,
    client_id: str,
    token_id: str,
    issued_at: int,
    lifetime_seconds: int,
    username: Optional[str] = None,
    tenant_id: Optional[str] = None,
    session_id: Optional[str] = None,
    roles: Iterable[str] = (),
    permissions: Iterable[str] = (),
    authz_version: Optional[str] = None,
) -> Dict[str, Any]:
    """The issuer-side twin of validate_claims: a payload the contract accepts.

    Used by Core to mint, and by LocalIssuer in tests, so the shape cannot
    drift between the two.
    """
    claims: Dict[str, Any] = {
        "iss": issuer,
        "sub": subject,
        "aud": audience,
        "azp": client_id,
        "jti": token_id,
        "iat": issued_at,
        "nbf": issued_at,
        "exp": issued_at + int(lifetime_seconds),
        "roles": sorted(set(roles)),
        "permissions": sorted(set(permissions)),
    }
    if username is not None:
        claims["preferred_username"] = username
    if tenant_id is not None:
        claims["tenant_id"] = tenant_id
    if session_id is not None:
        claims["sid"] = session_id
    if authz_version is not None:
        claims["authz_ver"] = authz_version
    return claims
