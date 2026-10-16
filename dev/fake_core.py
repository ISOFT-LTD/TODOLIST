"""A stand-in for Cobalt Core, for developing this app without Core.

    pip install -r backend/requirements.txt -r backend/requirements-dev.txt
    python dev/fake_core.py          # starts the backend on :8000, this on :8001
    cd frontend && pnpm dev          # the UI on :5173; Vite forwards /api to :8001

Per request it does what Core's /apps proxy does: mints a fresh, short-lived
delegated token for this app - with the same claim builder Core uses - and
forwards the call to the backend as ``Authorization: Bearer``. An upstream 401
comes back as 502, as it does from Core, because to the browser a 401 means
"your session has ended". The token carries your decision on each of the app's
actions; when the backend answers an action with Core's approval challenge,
this answers 202 PENDING as Core does once it has stored the request (it
stores nothing: there is nobody here to approve it).

This is not a way in. The backend has no idea this script exists: it trusts
whichever key COBALT_CORE_JWKS_FILE names, and this script starts it pointed
at a throwaway key generated here at startup. Deployed, the backend points at
Core's real JWKS and nothing here is involved.

Who you are, from the environment:

    DEV_USER_ID      the user id (the token's sub)            [1]
    DEV_USERNAME     the display name                         [developer]
    DEV_ACCESS       write: every action allowed               [write]
                     read: only todo.view and predefined.view
                     approval: views allowed, every change needs approval
"""

import itertools
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, Request, Response  # noqa: E402

from cobalt_identity.testing import LocalIssuer  # noqa: E402

APP_KEY = os.getenv("COBALT_AUDIENCE", "todo")
TENANT = os.getenv("COBALT_TENANT_ID", "dev")
USER_ID = os.getenv("DEV_USER_ID", "1")
USERNAME = os.getenv("DEV_USERNAME", "developer")
ACCESS = os.getenv("DEV_ACCESS", "write").strip().lower()
BACKEND_PORT = int(os.getenv("DEV_BACKEND_PORT", "8000"))
PORT = int(os.getenv("DEV_CORE_PORT", "8001"))
JWKS_FILE = ROOT / "dev" / ".dev-jwks.json"

issuer = LocalIssuer(tenant_id=TENANT)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
backend = httpx.AsyncClient(base_url=f"http://127.0.0.1:{BACKEND_PORT}", timeout=30)


# The actions pulsar.yaml declares, by the names the token carries them under.
VIEWS = ("todo.view", "predefined.view")
CHANGES = (
    "todo.create", "todo.update", "todo.delete",
    "predefined.create", "predefined.update", "predefined.delete",
)
CHANGE_DECISION = {"write": "ALLOW", "approval": "REQUIRE_APPROVAL"}.get(ACCESS, "DENY")
approval_ids = itertools.count(1)


def _action_permissions():
    """Your decision on each action, as Core's token carries it."""
    return {
        **{key: "ALLOW" for key in VIEWS},
        **{key: CHANGE_DECISION for key in CHANGES},
    }


def _pending(upstream):
    """Core's answer to the browser for the backend's approval challenge, or None."""
    action = upstream.headers.get("x-cobalt-approval-action")
    if upstream.status_code != 202 or upstream.headers.get("x-cobalt-approval-required") != "true":
        return None
    body = {"detail": {
        "status": "PENDING",
        "approval_request_id": next(approval_ids),
        "action_key": f"{APP_KEY}.{action}",
        "message": "Approval request created",
    }}
    return Response(json.dumps(body), status_code=202, media_type="application/json")


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def forward(path: str, request: Request):
    decisions = _action_permissions()
    token = issuer.mint(
        USER_ID, APP_KEY, username=USERNAME, action_permissions=decisions,
        actions=sorted(key for key, decision in decisions.items() if decision == "ALLOW"),
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": request.headers.get("accept", "application/json"),
    }
    if "content-type" in request.headers:
        headers["Content-Type"] = request.headers["content-type"]

    upstream = await backend.request(
        request.method, f"/api/{path}", params=request.query_params,
        content=await request.body(), headers=headers,
    )
    if upstream.status_code == 401:
        return Response('{"detail":"The application rejected Core\'s identity"}',
                        status_code=502, media_type="application/json")
    pending = _pending(upstream)
    if pending is not None:
        return pending
    return Response(upstream.content, status_code=upstream.status_code,
                    media_type=upstream.headers.get("content-type"))


def main():
    JWKS_FILE.write_text(json.dumps(issuer.jwks()), encoding="utf-8")
    env = {
        **os.environ,
        "COBALT_AUDIENCE": APP_KEY,
        "COBALT_ISSUER": issuer.issuer,
        "COBALT_TENANT_ID": TENANT,
        "COBALT_CORE_JWKS_FILE": str(JWKS_FILE),
    }
    env.pop("COBALT_CORE_JWKS_URL", None)
    child = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--port", str(BACKEND_PORT), "--reload"],
        cwd=BACKEND, env=env,
    )
    print(f"\n  fake Core on http://127.0.0.1:{PORT}  ->  backend on :{BACKEND_PORT}")
    print(f"  you are user {USER_ID} ({USERNAME}), access: {ACCESS}, tenant: {TENANT}")
    print("  run the UI:  cd frontend && pnpm dev\n")
    try:
        uvicorn.run(app, host="127.0.0.1", port=PORT)
    finally:
        child.terminate()


if __name__ == "__main__":
    main()
