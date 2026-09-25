"""Run the service exactly as behind Core, with a stand-in for Core's key.

auth.py builds its verifier when it is imported, from the environment. So the
environment is set here, at conftest import, before any test module imports
main: a throwaway signing key plays Core's, its public half is written to a
JWKS file, and the service is told to trust that file - the same setting
(COBALT_CORE_JWKS_FILE) a deployment can use. Nothing in the service knows it
is under test.

Tokens come from the SDK's LocalIssuer, which builds claims with the same
function Core uses, so a token accepted here is shaped exactly like Core's.
"""

import json
import os
import sys
import tempfile

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from cobalt_identity.testing import LocalIssuer  # noqa: E402

TENANT = "itec-test"
AUDIENCE = "todo"
READ = f"{AUDIENCE}.todo.read"
WRITE = f"{AUDIENCE}.todo.all"

ISSUER = LocalIssuer(tenant_id=TENANT)

_workdir = tempfile.mkdtemp(prefix="todo-tests-")
_jwks = os.path.join(_workdir, "core-jwks.json")
with open(_jwks, "w", encoding="utf-8") as handle:
    json.dump(ISSUER.jwks(), handle)

os.environ.update({
    "COBALT_AUDIENCE": AUDIENCE,
    "COBALT_ISSUER": "cobalt-core",
    "COBALT_TENANT_ID": TENANT,
    "COBALT_CORE_JWKS_FILE": _jwks,
    "TODO_DATA_FILE": os.path.join(_workdir, "todos.json"),
})
os.environ.pop("COBALT_CORE_JWKS_URL", None)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """A client over the real app, on a data file of its own."""
    import database
    from fastapi.testclient import TestClient

    import main

    monkeypatch.setattr(database, "DATA_FILE", str(tmp_path / "todos.json"))
    with TestClient(main.app) as test_client:
        yield test_client


def as_user(subject="17", *, permissions=(READ, WRITE), username="alice", **overrides):
    """Headers carrying a fresh token for one call - Core mints one per call."""
    token = ISSUER.mint(subject, overrides.pop("audience", AUDIENCE),
                        permissions=permissions, username=username, **overrides)
    return {"Authorization": f"Bearer {token}"}
