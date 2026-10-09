"""Todo app - FastAPI service behind Cobalt Core.

Serves the CRUD API under /api/todos and /api/predefined-lists. Data is
stored in JSON files.

THE BROWSER NEVER CALLS THIS SERVICE. It talks to Cobalt Core only, at
``/apps/todo/...``, with its session cookie. Core checks the session and that
the user may reach this app at all, mints a short-lived JWT for this audience,
and forwards the request here with ``Authorization: Bearer <jwt>``. This
service verifies that token on every call (auth.py) and decides what the user
may do from the actions inside it. It holds no session, no cookie and no
password, and never touches Core's database.

Which is why there is no CORS middleware: no browser origin is ever allowed to
call this service directly.

    GET    /api/todos          list this user's todos          todo.read_todo
                               (?computer_id=N: only that computer's)
    POST   /api/todos          create                          todo.add_todo
    PUT    /api/todos/{id}     update title and/or done        todo.update_todo
    DELETE /api/todos/{id}     delete                          todo.delete_todo
    GET    /api/predefined-lists        this user's predefined lists    todo.read_predefined_list
    POST   /api/predefined-lists        create                          todo.add_predefined_list
    PUT    /api/predefined-lists/{id}   update name and/or items        todo.update_predefined_list
    DELETE /api/predefined-lists/{id}   delete                          todo.delete_predefined_list
    GET    /api/me             who Core says is calling        any valid token
    GET    /api/health         liveness                        open
    GET    /api/manifest       this app's manifest, for Core   open
"""

import json
import os
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Response, status

import models
from auth import (
    ADD_PREDEFINED_LIST,
    ADD_TODO,
    DELETE_PREDEFINED_LIST,
    DELETE_TODO,
    READ_PREDEFINED_LIST,
    READ_TODO,
    UPDATE_PREDEFINED_LIST,
    UPDATE_TODO,
    get_delegated_principal,
    owner_of,
    require_delegated_action,
)
from database import init_storage
from schemas import (
    PredefinedListCreate,
    PredefinedListOut,
    PredefinedListUpdate,
    TodoCreate,
    TodoOut,
    TodoUpdate,
)

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
    version="1.3.0",
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
def list_todos(
    computer_id: Optional[int] = Query(None, ge=1),
    who=Depends(require_delegated_action(READ_TODO)),
):
    """This user's todos, newest first; only one computer's with ``computer_id``."""
    return models.list_todos(*owner_of(who), computer_id=computer_id)


@todos_router.post("", response_model=TodoOut, status_code=status.HTTP_201_CREATED)
def create_todo(todo: TodoCreate, who=Depends(require_delegated_action(ADD_TODO))):
    """Create a new todo for this user, about a computer when it names one."""
    return models.create_todo(*owner_of(who), todo.title, computer_id=todo.computer_id)


@todos_router.put("/{todo_id}", response_model=TodoOut)
def update_todo(
    todo_id: int,
    todo: TodoUpdate,
    who=Depends(require_delegated_action(UPDATE_TODO)),
):
    """Update a todo's title, its completion state, or both."""
    updated = models.update_todo(*owner_of(who), todo_id, todo.title, todo.done)
    if not updated:
        raise HTTPException(status_code=404, detail="Todo not found")
    return updated


@todos_router.delete("/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: int, who=Depends(require_delegated_action(DELETE_TODO))):
    """Delete a todo."""
    if not models.delete_todo(*owner_of(who), todo_id):
        raise HTTPException(status_code=404, detail="Todo not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


app.include_router(todos_router)

# ---------------------------------------------------------------------------
# Predefined lists - reusable templates, kept with the same identity and
# actions as todos. Creating todos from one is a later feature.
# ---------------------------------------------------------------------------

predefined_router = APIRouter(prefix="/api/predefined-lists", tags=["Predefined lists"])


@predefined_router.get("", response_model=List[PredefinedListOut])
def list_predefined_lists(
    who=Depends(require_delegated_action(READ_PREDEFINED_LIST)),
):
    """This user's predefined lists, newest first."""
    return models.list_predefined_lists(*owner_of(who))


@predefined_router.post("", response_model=PredefinedListOut, status_code=status.HTTP_201_CREATED)
def create_predefined_list(
    body: PredefinedListCreate,
    who=Depends(require_delegated_action(ADD_PREDEFINED_LIST)),
):
    """Create a new predefined list for this user."""
    return models.create_predefined_list(*owner_of(who), body.name, body.items)


@predefined_router.put("/{list_id}", response_model=PredefinedListOut)
def update_predefined_list(
    list_id: int,
    body: PredefinedListUpdate,
    who=Depends(require_delegated_action(UPDATE_PREDEFINED_LIST)),
):
    """Update a predefined list's name, its items, or both."""
    updated = models.update_predefined_list(*owner_of(who), list_id, body.name, body.items)
    if not updated:
        raise HTTPException(status_code=404, detail="Predefined list not found")
    return updated


@predefined_router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_predefined_list(
    list_id: int,
    who=Depends(require_delegated_action(DELETE_PREDEFINED_LIST)),
):
    """Delete a predefined list."""
    if not models.delete_predefined_list(*owner_of(who), list_id):
        raise HTTPException(status_code=404, detail="Predefined list not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


app.include_router(predefined_router)

# ---------------------------------------------------------------------------
# Identity, health, manifest
# ---------------------------------------------------------------------------

@app.get("/api/me", tags=["Identity"])
def whoami(who=Depends(get_delegated_principal)):
    """Who Core says is calling, including the delegated action keys."""
    write_actions = {
        "todo.add_todo",
        "todo.update_todo",
        "todo.delete_todo",
        "todo.add_predefined_list",
        "todo.update_predefined_list",
        "todo.delete_predefined_list",
    }
    return {
        "subject": who.subject,
        "username": who.username,
        "tenant_id": who.tenant_id,
        "actions": sorted(who.actions),
        # Compatibility for the current UI while it adopts granular actions.
        "can_read": bool({"todo.read_todo", "todo.read_predefined_list"} & who.actions),
        "can_write": bool(write_actions & who.actions),
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
