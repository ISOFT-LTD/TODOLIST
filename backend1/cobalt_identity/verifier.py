"""TokenVerifier: from a bearer string to a DelegatedIdentity, or a refusal.

    verifier = TokenVerifier(
        issuer="cobalt-core",
        audience="documents-api",
        keys=JwksUrl("https://core.internal/auth/.well-known/jwks.json"),
        expected_tenant="itec-prod",
    )
    identity = verifier.verify(token)      # raises VerificationError

The order of checks is the order that leaks least and costs least: parse,
refuse unknown algorithms before any key lookup, find the key by ``kid``
(refreshing the JWKS once if it is unknown - that is how rotation works),
verify the signature, then apply the claims contract, then the replay check.

KEY SOURCES. ``StaticKeys`` for keys handed over in configuration;
``JwksUrl`` for Core's published document, cached and refreshed on an
unknown ``kid`` no more than once per ``min_refresh_interval``. Fetching uses
``urllib`` so the package depends on nothing but ``cryptography``; pass
``fetch=`` to use your own HTTP client.

REPLAY. A delegated token lives a few minutes and Core mints a fresh one per
call, so a replayed ``jti`` is either a bug or an attack. ``ReplayCache``
remembers seen ids for as long as they could still be valid. It is
in-process; a service running several replicas that wants a shared cache
passes any object with ``remember(jti, ttl_seconds) -> bool`` (True when the
id was not seen before) - a Redis SET NX EX is exactly that.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Protocol, Tuple

from . import jws
from .claims import (
    DEFAULT_LEEWAY_SECONDS,
    DEFAULT_MAX_LIFETIME_SECONDS,
    ClaimError,
    DelegatedIdentity,
    validate_claims,
)

KeyTable = Dict[str, Tuple[jws.PublicKey, str]]  # kid -> (public key, algorithm)


class VerificationError(Exception):
    """The token was refused. ``code`` is a short stable reason for logs and
    for the ``error`` parameter of WWW-Authenticate; never put ``message`` in
    a response body to an untrusted caller."""

    def __init__(self, code: str, message: Optional[str] = None):
        super().__init__(message or code)
        self.code = code


class KeySource(Protocol):
    def public_keys(self, *, force_refresh: bool = False) -> KeyTable: ...


def _table_from_jwks(document: Mapping[str, Any]) -> KeyTable:
    keys = document.get("keys")
    if not isinstance(keys, list):
        raise VerificationError("bad_jwks", "JWKS document has no 'keys' list")
    table: KeyTable = {}
    for entry in keys:
        if not isinstance(entry, dict):
            continue
        if entry.get("use") not in (None, "sig"):
            continue
        kid = entry.get("kid")
        if not isinstance(kid, str) or not kid:
            continue
        try:
            public_key = jws.public_key_from_jwk(entry)
        except jws.JWSError:
            # An entry with a kty we do not support is skipped, not fatal: the
            # document may legitimately carry keys for other consumers.
            continue
        algorithm = entry.get("alg") or jws.algorithm_for(public_key)
        if algorithm != jws.algorithm_for(public_key):
            continue
        table[kid] = (public_key, algorithm)
    return table


class StaticKeys:
    """Keys from configuration: a JWKS dict, or PEM public keys."""

    def __init__(self, jwks: Optional[Mapping[str, Any]] = None,
                 pems: Iterable[Tuple[Optional[str], str]] = ()):
        table: KeyTable = {}
        if jwks is not None:
            table.update(_table_from_jwks(jwks))
        for kid, pem in pems:
            public_key = jws.load_public_key(pem)
            table[kid or jws.thumbprint(public_key)] = (public_key, jws.algorithm_for(public_key))
        self._table = table

    def public_keys(self, *, force_refresh: bool = False) -> KeyTable:
        return dict(self._table)


def _default_fetch(url: str, timeout: float) -> Mapping[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - https URL from configuration
        return json.loads(response.read().decode("utf-8"))


class JwksUrl:
    """Core's published JWKS, cached, refreshed on an unknown kid.

    ``cache_ttl`` bounds how stale a known key may be; ``min_refresh_interval``
    bounds how often an unknown kid may trigger a fetch, so a flood of tokens
    with garbage kids cannot turn the verifier into a request amplifier.
    """

    def __init__(
        self,
        url: str,
        *,
        fetch: Optional[Callable[[str, float], Mapping[str, Any]]] = None,
        timeout: float = 5.0,
        cache_ttl: float = 300.0,
        min_refresh_interval: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.url = url
        self._fetch = fetch or _default_fetch
        self._timeout = timeout
        self._cache_ttl = cache_ttl
        self._min_refresh = min_refresh_interval
        self._clock = clock
        self._lock = threading.Lock()
        self._table: KeyTable = {}
        self._fetched_at: Optional[float] = None
        self._last_refresh_attempt: Optional[float] = None

    def _should_refresh(self, *, force_refresh: bool) -> bool:
        """Decide under the lock; the fetch itself happens outside it.

        Every refresh - stale cache or unknown kid - is subject to
        ``min_refresh_interval`` once a table has been loaded. Without that a
        Core outage longer than ``cache_ttl`` would make every verification
        in every replica attempt (and wait out) its own fetch.
        """
        now = self._clock()
        never = self._fetched_at is None
        if never:
            return True
        throttled = (
            self._last_refresh_attempt is not None
            and now - self._last_refresh_attempt < self._min_refresh
        )
        if throttled:
            return False
        stale = now - self._fetched_at > self._cache_ttl
        return stale or force_refresh

    def public_keys(self, *, force_refresh: bool = False) -> KeyTable:
        with self._lock:
            never = self._fetched_at is None
            if not self._should_refresh(force_refresh=force_refresh):
                return dict(self._table)
            self._last_refresh_attempt = self._clock()

        # Network I/O outside the lock: a slow or dead Core must not serialise
        # every verifier call behind one socket timeout.
        try:
            document = self._fetch(self.url, self._timeout)
            table = _table_from_jwks(document)
        except Exception as exc:  # noqa: BLE001 - network, JSON, TLS, bad document
            if never:
                raise VerificationError("jwks_unavailable", str(exc)) from exc
            # Keep serving the last good table: a brief Core outage must not
            # take every service down with it (section 4.3).
            with self._lock:
                return dict(self._table)

        with self._lock:
            if table or never:
                # An empty document is what a dormant Core publishes. Once
                # keys have been seen, an empty answer is treated as "nothing
                # new" rather than "forget everything": the tokens in flight
                # were signed by keys we hold, and dropping them would refuse
                # every call for the length of a configuration mistake.
                self._table = table
            self._fetched_at = self._clock()
            return dict(self._table)


class ReplayCache:
    """In-process ``jti`` memory. ``remember`` is True for a first sighting."""

    # Prune when the map has grown past this many ids, and then not again
    # until this many more have been added - so a busy service pays the
    # O(n) sweep once per batch of inserts rather than once per request.
    PRUNE_THRESHOLD = 10_000

    def __init__(self, clock: Callable[[], float] = time.time):
        self._seen: Dict[str, float] = {}
        self._clock = clock
        self._lock = threading.Lock()
        self._inserts_since_prune = 0

    def remember(self, token_id: str, ttl_seconds: int) -> bool:
        now = self._clock()
        with self._lock:
            if (len(self._seen) > self.PRUNE_THRESHOLD
                    and self._inserts_since_prune >= self.PRUNE_THRESHOLD // 10):
                self._prune(now)
                self._inserts_since_prune = 0
            expires = self._seen.get(token_id)
            if expires is not None and expires > now:
                return False
            self._seen[token_id] = now + max(int(ttl_seconds), 1)
            self._inserts_since_prune += 1
            return True

    def _prune(self, now: float) -> None:
        for token_id, expires in list(self._seen.items()):
            if expires <= now:
                del self._seen[token_id]


class TokenVerifier:
    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        keys: KeySource,
        expected_tenant: Optional[str] = None,
        leeway: int = DEFAULT_LEEWAY_SECONDS,
        max_lifetime: Optional[int] = DEFAULT_MAX_LIFETIME_SECONDS,
        allowed_algorithms: Iterable[str] = jws.ALGORITHMS,
        replay_store: Optional[Any] = None,
        clock: Callable[[], float] = time.time,
    ):
        if not issuer or not audience:
            raise ValueError("issuer and audience are required")
        self.issuer = issuer
        self.audience = audience
        self.keys = keys
        self.expected_tenant = expected_tenant
        self.leeway = leeway
        self.max_lifetime = max_lifetime
        self.allowed_algorithms = frozenset(allowed_algorithms) & frozenset(jws.ALGORITHMS)
        if not self.allowed_algorithms:
            raise ValueError("no allowed algorithm")
        self.replay_store = replay_store
        self._clock = clock

    def _key_for(self, kid: str) -> Tuple[jws.PublicKey, str]:
        table = self.keys.public_keys()
        if kid not in table:
            # Rotation: Core published a new key and this service has not
            # seen it yet. One refresh, rate-limited by the source.
            table = self.keys.public_keys(force_refresh=True)
        if kid not in table:
            raise VerificationError("unknown_key", f"no public key for kid {kid!r}")
        return table[kid]

    def verify(self, token: str) -> DelegatedIdentity:
        try:
            header, payload, signing_input, signature = jws.split_compact(token)
        except jws.JWSError as exc:
            raise VerificationError(exc.code, str(exc)) from exc

        if header.get("typ") not in (None, "JWT"):
            raise VerificationError("wrong_type", f"typ {header.get('typ')!r} is not JWT")

        algorithm = header.get("alg")
        if algorithm not in self.allowed_algorithms:
            raise VerificationError("unsupported_algorithm", f"alg {algorithm!r} is not allowed")

        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise VerificationError("missing_kid", "token header has no kid")

        public_key, key_algorithm = self._key_for(kid)
        if key_algorithm != algorithm:
            raise VerificationError("algorithm_mismatch",
                                    f"token alg {algorithm} but key {kid!r} is {key_algorithm}")
        try:
            jws.verify_signature(signing_input, signature, public_key, algorithm)
        except jws.JWSError as exc:
            raise VerificationError(exc.code, str(exc)) from exc

        try:
            identity = validate_claims(
                payload,
                issuer=self.issuer,
                audience=self.audience,
                now=self._clock(),
                leeway=self.leeway,
                expected_tenant=self.expected_tenant,
                max_lifetime=self.max_lifetime,
            )
        except ClaimError as exc:
            raise VerificationError(exc.code, str(exc)) from exc

        if self.replay_store is not None and identity.token_id:
            ttl = max(identity.expires_at - int(self._clock()) + self.leeway, 1)
            if not self.replay_store.remember(identity.token_id, ttl):
                raise VerificationError("replayed", "token id was already presented")

        return identity
