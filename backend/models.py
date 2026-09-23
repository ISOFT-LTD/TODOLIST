"""Todo record and the CRUD operations over the JSON store.

Every todo belongs to one person: the tenant and user id from Cobalt Core's
delegated identity (see auth.py). Every operation is scoped to that owner, so
nobody can list, change or delete somebody else's todos - and asking for
another person's todo by id answers "not found", not "forbidden", so ids reveal
nothing about who else uses the list.

Rows written before todos had owners belong to nobody and are never shown.
"""

from dataclasses import asdict, dataclass
from typing import List, Optional

from database import read_todos, storage_lock, write_todos


@dataclass
class Todo:
    id: int
    title: str
    done: bool = False
    # Opaque strings from Core's token: tenant_id and sub. Never a foreign key
    # into Core's database, never the username (which can change).
    tenant_id: str = ""
    owner: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def belongs_to(self, tenant_id: str, owner: str) -> bool:
        return bool(owner) and self.owner == owner and self.tenant_id == tenant_id

    @staticmethod
    def from_dict(raw: dict) -> "Todo":
        return Todo(
            id=int(raw["id"]),
            title=str(raw["title"]),
            done=bool(raw.get("done", False)),
            tenant_id=str(raw.get("tenant_id") or ""),
            owner=str(raw.get("owner") or ""),
        )


def _next_id(rows: List[dict]) -> int:
    return max((int(row["id"]) for row in rows), default=0) + 1


def list_todos(tenant_id: str, owner: str) -> List[Todo]:
    """This person's todos, newest first."""
    todos = (Todo.from_dict(row) for row in read_todos())
    mine = (todo for todo in todos if todo.belongs_to(tenant_id, owner))
    return sorted(mine, key=lambda t: t.id, reverse=True)


def create_todo(tenant_id: str, owner: str, title: str) -> Todo:
    """Append a new todo for this person and return it."""
    with storage_lock:
        rows = read_todos()
        todo = Todo(id=_next_id(rows), title=title, done=False,
                    tenant_id=tenant_id, owner=owner)
        rows.append(todo.to_dict())
        write_todos(rows)
    return todo


def update_todo(tenant_id: str, owner: str, todo_id: int,
                title: Optional[str], done: Optional[bool]) -> Optional[Todo]:
    """Update one of this person's todos. None if there is no such todo of theirs."""
    with storage_lock:
        rows = read_todos()
        for index, row in enumerate(rows):
            todo = Todo.from_dict(row)
            if todo.id != todo_id or not todo.belongs_to(tenant_id, owner):
                continue

            if title is not None:
                todo.title = title
            if done is not None:
                todo.done = done

            rows[index] = todo.to_dict()
            write_todos(rows)
            return todo
    return None


def delete_todo(tenant_id: str, owner: str, todo_id: int) -> bool:
    """Delete one of this person's todos. False if there is no such todo of theirs."""
    with storage_lock:
        rows = read_todos()
        remaining = [
            row for row in rows
            if not (int(row["id"]) == todo_id and Todo.from_dict(row).belongs_to(tenant_id, owner))
        ]
        if len(remaining) == len(rows):
            return False

        write_todos(remaining)
    return True
