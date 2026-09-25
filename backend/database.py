"""JSON file storage for the Todo plugin.

Each kind of record lives in its own JSON file holding an array of objects:
todos in one, predefined lists in another. A file is the whole database for
its records: it is read on every request and rewritten after every change,
which is fine at POC scale and keeps the plugin dependency-free.
"""

import json
import os
import tempfile
from threading import Lock
from typing import List

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# In Docker these are /data/todos.json and /data/predefined_lists.json, on a
# mounted volume. Locally they sit next to this file so the plugin runs with
# no setup.
DATA_FILE = os.getenv("TODO_DATA_FILE", os.path.join(BASE_DIR, "todos.json"))
PREDEFINED_FILE = os.getenv(
    "TODO_PREDEFINED_FILE", os.path.join(BASE_DIR, "predefined_lists.json")
)

# FastAPI runs sync endpoints in a thread pool, so read-modify-write cycles
# have to be serialised or concurrent requests can lose each other's changes.
storage_lock = Lock()


def init_storage() -> None:
    """Create each data file with an empty array if it does not exist yet."""
    for path in (DATA_FILE, PREDEFINED_FILE):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        if not os.path.exists(path):
            write_rows(path, [])


def read_rows(path: str) -> List[dict]:
    """Return the records stored in ``path``, or an empty list if it is missing."""
    if not os.path.exists(path):
        return []

    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON array")
    return data


def write_rows(path: str, rows: List[dict]) -> None:
    """Write the records back to ``path``, replacing the file atomically.

    Writing to a temporary file and renaming means an interrupted write cannot
    leave a half-written file behind.
    """
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2)
        os.replace(tmp_path, path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


# The two stores. Each reads its module-level path when called, so a test can
# point them elsewhere without re-importing anything.

def read_todos() -> List[dict]:
    return read_rows(DATA_FILE)


def write_todos(todos: List[dict]) -> None:
    write_rows(DATA_FILE, todos)


def read_predefined_lists() -> List[dict]:
    return read_rows(PREDEFINED_FILE)


def write_predefined_lists(lists: List[dict]) -> None:
    write_rows(PREDEFINED_FILE, lists)
