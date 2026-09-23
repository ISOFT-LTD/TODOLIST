"""A stand-in for Cobalt Core, for developing this app without Core.

    pip install -r backend/requirements.txt -r backend/requirements-dev.txt
    python dev/fake_core.py          # starts the backend on :8000, this on :8001
    cd frontend && npm run dev       # the UI on :5173; Vite forwards /api to :8001

Per request it does what Core's /apps proxy does: mints a fresh, short-lived
delegated token for this app - with the same claim builder Core uses - and
forwards the call to the backend as ``Authorization: Bearer``. An upstream 401
comes back as 502, as it does from Core, because to the browser a 401 means
"your session has ended".

This is not a way in. The backend has no idea this script exists: it trusts
whichever key COBALT_CORE_JWKS_FILE names, and this script starts it pointed
at a throwaway key generated here at startup. Deployed, the backend points at
Core's real JWKS and nothing here is involved.

Who you are, from the environment:

    DEV_USER_ID      the user id (the token's sub)            [1]
    DEV_USERNAME     the display name                         [developer]
    DEV_ACCESS       write (Read + All on the tab) or read    [write]
"""

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
TAB = os.getenv("COBALT_PERMISSION_TAB", "todo")
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


def _permissions():
    read = f"{APP_KEY}.{TAB}.read"
    return [read, f"{APP_KEY}.{TAB}.all"] if ACCESS == "write" else [read]


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def forward(path: str, request: Request):
    token = issuer.mint(USER_ID, APP_KEY, permissions=_permissions(), username=USERNAME)
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
    print("  run the UI:  cd frontend && npm run dev\n")
    try:
        uvicorn.run(app, host="127.0.0.1", port=PORT)
    finally:
        child.terminate()


if __name__ == "__main__":
    main()
