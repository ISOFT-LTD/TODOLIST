"""Todo record and the CRUD operations over the JSON store."""

from dataclasses import asdict, dataclass
from typing import List, Optional

from database import read_todos, storage_lock, write_todos


@dataclass
class Todo:
    id: int
    title: str
    done: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(raw: dict) -> "Todo":
        return Todo(
            id=int(raw["id"]),
            title=str(raw["title"]),
            done=bool(raw.get("done", False)),
        )


def _next_id(rows: List[dict]) -> int:
    return max((int(row["id"]) for row in rows), default=0) + 1


def list_todos() -> List[Todo]:
    """Return all todos, newest first."""
    rows = read_todos()
    return sorted((Todo.from_dict(row) for row in rows), key=lambda t: t.id, reverse=True)


def get_todo(todo_id: int) -> Optional[Todo]:
    """Return one todo, or None if it does not exist."""
    for row in read_todos():
        if int(row["id"]) == todo_id:
            return Todo.from_dict(row)
    return None


def create_todo(title: str) -> Todo:
    """Append a new todo and return it."""
    with storage_lock:
        rows = read_todos()
        todo = Todo(id=_next_id(rows), title=title, done=False)
        rows.append(todo.to_dict())
        write_todos(rows)
    return todo


def update_todo(todo_id: int, title: Optional[str], done: Optional[bool]) -> Optional[Todo]:
    """Update a todo in place. Returns None if it does not exist."""
    with storage_lock:
        rows = read_todos()
        for index, row in enumerate(rows):
            if int(row["id"]) != todo_id:
                continue

            todo = Todo.from_dict(row)
            if title is not None:
                todo.title = title
            if done is not None:
                todo.done = done

            rows[index] = todo.to_dict()
            write_todos(rows)
            return todo
    return None


def delete_todo(todo_id: int) -> bool:
    """Delete a todo. Returns False if it did not exist."""
    with storage_lock:
        rows = read_todos()
        remaining = [row for row in rows if int(row["id"]) != todo_id]
        if len(remaining) == len(rows):
            return False

        write_todos(remaining)
    return True
