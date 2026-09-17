"""JSON file storage for the Todo plugin.

Todos live in a single JSON file holding an array of objects. The file is the
whole database: it is read on every request and rewritten after every change,
which is fine at POC scale and keeps the plugin dependency-free.
"""

import json
import os
import tempfile
from threading import Lock
from typing import List

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# In Docker this is /data/todos.json, on a mounted volume. Locally it sits
# next to this file so the plugin runs with no setup.
DATA_FILE = os.getenv("TODO_DATA_FILE", os.path.join(BASE_DIR, "todos.json"))

# FastAPI runs sync endpoints in a thread pool, so read-modify-write cycles
# have to be serialised or concurrent requests can lose each other's changes.
storage_lock = Lock()


def _data_dir() -> str:
    return os.path.dirname(os.path.abspath(DATA_FILE))


def init_storage() -> None:
    """Create the data file with an empty array if it does not exist yet."""
    os.makedirs(_data_dir(), exist_ok=True)
    if not os.path.exists(DATA_FILE):
        write_todos([])


def read_todos() -> List[dict]:
    """Return the stored todos, or an empty list if the file is missing."""
    if not os.path.exists(DATA_FILE):
        return []

    with open(DATA_FILE, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    if not isinstance(data, list):
        raise ValueError(f"{DATA_FILE} must contain a JSON array")
    return data


def write_todos(todos: List[dict]) -> None:
    """Write the todos back to disk, replacing the file atomically.

    Writing to a temporary file and renaming means an interrupted write cannot
    leave a half-written file behind.
    """
    directory = _data_dir()
    os.makedirs(directory, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(todos, fh, indent=2)
        os.replace(tmp_path, DATA_FILE)
    except BaseException:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise
