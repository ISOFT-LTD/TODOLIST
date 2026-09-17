"""Todo plugin - FastAPI microservice.

Serves the CRUD API under /api/todos and, when a built frontend is present,
the static frontend from the same origin. Data is stored in a JSON file.

In production only the Core backend calls this service, server to server:
Core authenticates the user's session, checks plugin permissions, and forwards
the request. Standalone, the page and API share one origin. Neither case
involves the browser making cross-origin calls here, so there is no CORS.
"""

import json
import os
from contextlib import asynccontextmanager
from typing import List

from fastapi import APIRouter, FastAPI, HTTPException, Response, status
from fastapi.staticfiles import StaticFiles

import models
from database import init_storage
from schemas import TodoCreate, TodoOut, TodoUpdate

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)

FRONTEND_DIST = os.getenv("FRONTEND_DIST", os.path.join(PROJECT_DIR, "frontend", "dist"))
MANIFEST_PATH = os.getenv("MANIFEST_PATH", os.path.join(PROJECT_DIR, "manifest.json"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the JSON data file on startup if it is not there yet."""
    init_storage()
    yield


app = FastAPI(
    title="Todo Plugin",
    version="1.0.0",
    description="Todo List plugin POC",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

todos_router = APIRouter(prefix="/api/todos", tags=["Todos"])


@todos_router.get("", response_model=List[TodoOut])
def list_todos():
    """Get all todos, newest first."""
    return models.list_todos()


@todos_router.post("", response_model=TodoOut, status_code=status.HTTP_201_CREATED)
def create_todo(todo: TodoCreate):
    """Create a new todo."""
    return models.create_todo(todo.title)


@todos_router.put("/{todo_id}", response_model=TodoOut)
def update_todo(todo_id: int, todo: TodoUpdate):
    """Update a todo title, its completion state, or both."""
    updated = models.update_todo(todo_id, todo.title, todo.done)
    if not updated:
        raise HTTPException(status_code=404, detail="Todo not found")
    return updated


@todos_router.delete("/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: int):
    """Delete a todo."""
    if not models.delete_todo(todo_id):
        raise HTTPException(status_code=404, detail="Todo not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


app.include_router(todos_router)


@app.get("/api/health", tags=["Health"])
def health():
    """Liveness probe for Docker and the future plugin host."""
    return {"status": "ok"}


@app.get("/api/manifest", tags=["Plugin"])
def manifest():
    """Return this plugin's manifest so an ITSM host can discover it.

    Read per request rather than cached, so editing manifest.json during the
    POC does not need a restart.
    """
    try:
        with open(MANIFEST_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Plugin manifest not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Plugin manifest is not valid JSON")


# Mounted last so the /api routes above take precedence. Only present once the
# frontend has been built (npm run build) - in dev, Vite serves it instead.
if os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
