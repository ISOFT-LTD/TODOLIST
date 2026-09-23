"""Todo app - FastAPI service behind Cobalt Core.

Serves the CRUD API under /api/todos. Data is stored in a JSON file.

THE BROWSER NEVER CALLS THIS SERVICE. It talks to Cobalt Core only, at
``/apps/todo/...``, with its session cookie. Core checks the session and that
the user may reach this app at all, mints a short-lived JWT for this audience,
and forwards the request here with ``Authorization: Bearer <jwt>``. This
service verifies that token on every call (auth.py) and decides what the user
may do from the permissions inside it. It holds no session, no cookie and no
password, and never touches Core's database.

Which is why there is no CORS middleware: no browser origin is ever allowed to
call this service directly.

    GET    /api/todos          list this user's todos          todo.todo.read
    POST   /api/todos          create                          todo.todo.all
    PUT    /api/todos/{id}     update title and/or done        todo.todo.all
    DELETE /api/todos/{id}     delete                          todo.todo.all
    GET    /api/me             who Core says is calling        any valid token
    GET    /api/health         liveness                        open
    GET    /api/manifest       this app's manifest, for Core   open
"""

import json
import os
from contextlib import asynccontextmanager
from typing import List

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Response, status

import models
from auth import CAN_READ, CAN_WRITE, can_read, can_write, identity, owner_of
from database import init_storage
from schemas import TodoCreate, TodoOut, TodoUpdate

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)

MANIFEST_PATH = os.getenv("MANIFEST_PATH", os.path.join(PROJECT_DIR, "manifest.json"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the JSON data file on startup if it is not there yet."""
    init_storage()
    yield


app = FastAPI(
    title="Todo List",
    version="1.1.0",
    description="Todo List app, served behind Cobalt Core's /apps proxy",
    lifespan=lifespan,
    # The schema sits under /api like everything else, where the manifest says.
    # No interactive docs: this is a private service, reached only by Core.
    openapi_url="/api/openapi.json",
    docs_url=None,
    redoc_url=None,
)

# ---------------------------------------------------------------------------
# Todos - every route needs Core's identity and the right permission
# ---------------------------------------------------------------------------

todos_router = APIRouter(prefix="/api/todos", tags=["Todos"])


@todos_router.get("", response_model=List[TodoOut])
def list_todos(who=Depends(can_read)):
    """This user's todos, newest first."""
    return models.list_todos(*owner_of(who))


@todos_router.post("", response_model=TodoOut, status_code=status.HTTP_201_CREATED)
def create_todo(todo: TodoCreate, who=Depends(can_write)):
    """Create a new todo for this user."""
    return models.create_todo(*owner_of(who), todo.title)


@todos_router.put("/{todo_id}", response_model=TodoOut)
def update_todo(todo_id: int, todo: TodoUpdate, who=Depends(can_write)):
    """Update a todo's title, its completion state, or both."""
    updated = models.update_todo(*owner_of(who), todo_id, todo.title, todo.done)
    if not updated:
        raise HTTPException(status_code=404, detail="Todo not found")
    return updated


@todos_router.delete("/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: int, who=Depends(can_write)):
    """Delete a todo."""
    if not models.delete_todo(*owner_of(who), todo_id):
        raise HTTPException(status_code=404, detail="Todo not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


app.include_router(todos_router)

# ---------------------------------------------------------------------------
# Identity, health, manifest
# ---------------------------------------------------------------------------


@app.get("/api/me", tags=["Identity"])
def whoami(who=Depends(identity)):
    """Who Core says is calling, and what they may do here.

    The UI uses ``can_write`` to hide the controls a read-only user cannot
    use, rather than letting them click and fail.
    """
    return {
        "subject": who.subject,
        "username": who.username,
        "tenant_id": who.tenant_id,
        "can_read": who.has_permission(CAN_READ),
        "can_write": who.has_permission(CAN_WRITE),
    }


@app.get("/api/health", tags=["Health"])
def health():
    """Liveness probe. Open, and says nothing about anyone."""
    return {"status": "ok"}


@app.get("/api/manifest", tags=["App"])
def manifest():
    """This app's manifest. Open: Core reads it to install the app, and it
    holds nothing secret.

    Read per request rather than cached, so editing manifest.json during the
    POC does not need a restart.
    """
    try:
        with open(MANIFEST_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="App manifest not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="App manifest is not valid JSON")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
