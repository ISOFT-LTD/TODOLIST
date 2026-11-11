"""Compact JWS (RFC 7515) over JSON claims (RFC 7519), with ``cryptography`` only.

Why not PyJWT. Core's environment carries the unrelated ``jwt`` distribution
(GehirnInc's python-jwt), which owns the ``jwt`` import name; installing
PyJWT beside it is a coin toss over which one ``import jwt`` returns. This
module is ~200 lines over primitives ``cryptography`` already ships, produces
standard tokens any JOSE library can verify, and has no name to fight over.

Two algorithms, and only two:

    RS256   RSA 2048+ with PKCS#1 v1.5 / SHA-256. The widest-supported
            asymmetric JOSE algorithm - every .NET, Java and Go JWT library
            verifies it - which matters for the Windows agent ecosystem.
    EdDSA   Ed25519 (RFC 8037). Smaller keys, faster, no padding oracle;
            offered for services whose stack supports it.

``none`` and every HMAC algorithm are refused by construction: an ``alg`` a
verifier does not list is not looked up, it is rejected. The header ``kid``
is mandatory in both directions; by default it is the RFC 7638 thumbprint of
the public key, so a key can be named without anyone choosing a name.
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any, Dict, Optional, Tuple, Union

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

ALGORITHMS = ("RS256", "EdDSA")

PrivateKey = Union[rsa.RSAPrivateKey, ed25519.Ed25519PrivateKey]
PublicKey = Union[rsa.RSAPublicKey, ed25519.Ed25519PublicKey]


class JWSError(ValueError):
    """The token is not a well-formed, verifiable JWS. ``code`` says why."""

    def __init__(self, code: str, message: Optional[str] = None):
        super().__init__(message or code)
        self.code = code


# ---------------------------------------------------------------------------
# base64url (RFC 4648 §5, no padding)
# ---------------------------------------------------------------------------

def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    if not isinstance(text, str):
        raise JWSError("malformed", "segment is not text")
    padding_needed = (-len(text)) % 4
    try:
        return base64.urlsafe_b64decode(text + "=" * padding_needed)
    except (ValueError, TypeError) as exc:
        raise JWSError("malformed", "segment is not base64url") from exc


def _int_to_b64url(value: int) -> str:
    length = (value.bit_length() + 7) // 8
    return b64url_encode(value.to_bytes(length, "big"))


def _b64url_to_int(text: str) -> int:
    return int.from_bytes(b64url_decode(text), "big")


# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------

def generate_private_key(algorithm: str = "RS256") -> PrivateKey:
    if algorithm == "RS256":
        return rsa.generate_private_key(public_exponent=65537, key_size=2048)
    if algorithm == "EdDSA":
        return ed25519.Ed25519PrivateKey.generate()
    raise JWSError("unsupported_algorithm", f"cannot generate a key for {algorithm!r}")


def algorithm_for(key: Union[PrivateKey, PublicKey]) -> str:
    if isinstance(key, (rsa.RSAPrivateKey, rsa.RSAPublicKey)):
        return "RS256"
    if isinstance(key, (ed25519.Ed25519PrivateKey, ed25519.Ed25519PublicKey)):
        return "EdDSA"
    raise JWSError("unsupported_algorithm", f"{type(key).__name__} is not an RSA or Ed25519 key")


def load_private_key(pem: Union[str, bytes], password: Optional[bytes] = None) -> PrivateKey:
    data = pem.encode("utf-8") if isinstance(pem, str) else pem
    key = serialization.load_pem_private_key(data, password=password)
    algorithm_for(key)  # refuses anything but RSA / Ed25519
    if isinstance(key, rsa.RSAPrivateKey) and key.key_size < 2048:
        raise JWSError("weak_key", f"RSA key is {key.key_size} bits; 2048 is the minimum")
    return key


def load_public_key(pem: Union[str, bytes]) -> PublicKey:
    data = pem.encode("utf-8") if isinstance(pem, str) else pem
    key = serialization.load_pem_public_key(data)
    algorithm_for(key)
    return key


def private_key_to_pem(key: PrivateKey) -> bytes:
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


def public_key_to_pem(key: PublicKey) -> bytes:
    return key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _required_jwk_members(public_key: PublicKey) -> Dict[str, str]:
    """The members RFC 7638 hashes, and the ones a JWK needs to be usable."""
    if isinstance(public_key, rsa.RSAPublicKey):
        numbers = public_key.public_numbers()
        return {"e": _int_to_b64url(numbers.e), "kty": "RSA", "n": _int_to_b64url(numbers.n)}
    if isinstance(public_key, ed25519.Ed25519PublicKey):
        raw = public_key.public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw,
        )
        return {"crv": "Ed25519", "kty": "OKP", "x": b64url_encode(raw)}
    raise JWSError("unsupported_algorithm", type(public_key).__name__)


def thumbprint(public_key: PublicKey) -> str:
    """RFC 7638 JWK thumbprint: SHA-256 over the canonical required members."""
    canonical = json.dumps(
        _required_jwk_members(public_key), separators=(",", ":"), sort_keys=True,
    ).encode("utf-8")
    return b64url_encode(hashlib.sha256(canonical).digest())


def public_jwk(public_key: PublicKey, kid: Optional[str] = None) -> Dict[str, str]:
    """A JWK for a JWKS document. ``kid`` defaults to the thumbprint."""
    jwk = dict(_required_jwk_members(public_key))
    jwk["alg"] = algorithm_for(public_key)
    jwk["use"] = "sig"
    jwk["kid"] = kid or thumbprint(public_key)
    return jwk


def public_key_from_jwk(jwk: Dict[str, Any]) -> PublicKey:
    kty = jwk.get("kty")
    try:
        if kty == "RSA":
            numbers = rsa.RSAPublicNumbers(_b64url_to_int(jwk["e"]), _b64url_to_int(jwk["n"]))
            return numbers.public_key()
        if kty == "OKP" and jwk.get("crv") == "Ed25519":
            return ed25519.Ed25519PublicKey.from_public_bytes(b64url_decode(jwk["x"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise JWSError("malformed_jwk", f"unusable JWK: {exc}") from exc
    raise JWSError("unsupported_algorithm", f"JWK kty={kty!r} crv={jwk.get('crv')!r}")


# ---------------------------------------------------------------------------
# Sign / verify
# ---------------------------------------------------------------------------

def _encode_json(value: Any) -> str:
    return b64url_encode(
        json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )


def sign_compact(
    claims: Dict[str, Any],
    private_key: PrivateKey,
    *,
    kid: Optional[str] = None,
    typ: str = "JWT",
) -> str:
    """``header.payload.signature`` for ``claims`` under ``private_key``."""
    algorithm = algorithm_for(private_key)
    header = {"alg": algorithm, "typ": typ, "kid": kid or thumbprint(private_key.public_key())}
    signing_input = f"{_encode_json(header)}.{_encode_json(claims)}".encode("ascii")
    if algorithm == "RS256":
        signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    else:
        signature = private_key.sign(signing_input)
    return f"{signing_input.decode('ascii')}.{b64url_encode(signature)}"


def split_compact(token: str) -> Tuple[Dict[str, Any], Dict[str, Any], bytes, bytes]:
    """``(header, payload, signing_input, signature)`` - parsed, NOT verified."""
    if not isinstance(token, str):
        raise JWSError("malformed", "token is not text")
    parts = token.strip().split(".")
    if len(parts) != 3 or not all(parts):
        raise JWSError("malformed", "a compact JWS has exactly three non-empty segments")
    header_b64, payload_b64, signature_b64 = parts
    try:
        header = json.loads(b64url_decode(header_b64))
        payload = json.loads(b64url_decode(payload_b64))
    except (ValueError, UnicodeDecodeError) as exc:
        raise JWSError("malformed", "header or payload is not JSON") from exc
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise JWSError("malformed", "header and payload must be JSON objects")
    if "crit" in header:
        # We understand no critical extensions, so RFC 7515 §4.1.11 says: reject.
        raise JWSError("unsupported_header", "critical header extensions are not supported")
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    return header, payload, signing_input, b64url_decode(signature_b64)


def verify_signature(
    signing_input: bytes, signature: bytes, public_key: PublicKey, algorithm: str,
) -> None:
    """Raises JWSError("invalid_signature") unless ``signature`` is valid."""
    if algorithm not in ALGORITHMS:
        raise JWSError("unsupported_algorithm", algorithm)
    if algorithm != algorithm_for(public_key):
        # A token claiming RS256 must not be checked against an Ed25519 key or
        # vice versa: the alg is bound to the key, never trusted from the header.
        raise JWSError("algorithm_mismatch", f"{algorithm} does not match the key's type")
    try:
        if algorithm == "RS256":
            public_key.verify(signature, signing_input, padding.PKCS1v15(), hashes.SHA256())
        else:
            public_key.verify(signature, signing_input)
    except InvalidSignature as exc:
        raise JWSError("invalid_signature") from exc
