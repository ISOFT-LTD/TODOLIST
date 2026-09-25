"""Todo and predefined-list records, and the CRUD operations over the JSON stores.

Every record belongs to one person: the tenant and user id from Cobalt Core's
delegated identity (see auth.py). Every operation is scoped to that owner, so
nobody can list, change or delete somebody else's records - and asking for
another person's record by id answers "not found", not "forbidden", so ids
reveal nothing about who else uses the app.

Rows written before todos had owners belong to nobody and are never shown.
"""

from dataclasses import asdict, dataclass, field
from typing import List, Optional

from database import (
    read_predefined_lists,
    read_todos,
    storage_lock,
    write_predefined_lists,
    write_todos,
)


def _belongs_to(row_tenant: str, row_owner: str, tenant_id: str, owner: str) -> bool:
    return bool(owner) and row_owner == owner and row_tenant == tenant_id


def _next_id(rows: List[dict]) -> int:
    return max((int(row["id"]) for row in rows), default=0) + 1


# ---------------------------------------------------------------------------
# Todos
# ---------------------------------------------------------------------------


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
        return _belongs_to(self.tenant_id, self.owner, tenant_id, owner)

    @staticmethod
    def from_dict(raw: dict) -> "Todo":
        return Todo(
            id=int(raw["id"]),
            title=str(raw["title"]),
            done=bool(raw.get("done", False)),
            tenant_id=str(raw.get("tenant_id") or ""),
            owner=str(raw.get("owner") or ""),
        )


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


# ---------------------------------------------------------------------------
# Predefined lists - reusable templates: a name and the items it would create.
# Turning one into real todos is a later feature; for now they are only kept.
# ---------------------------------------------------------------------------


@dataclass
class PredefinedList:
    id: int
    name: str
    items: List[str] = field(default_factory=list)
    tenant_id: str = ""
    owner: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def belongs_to(self, tenant_id: str, owner: str) -> bool:
        return _belongs_to(self.tenant_id, self.owner, tenant_id, owner)

    @staticmethod
    def from_dict(raw: dict) -> "PredefinedList":
        return PredefinedList(
            id=int(raw["id"]),
            name=str(raw["name"]),
            items=[str(item) for item in raw.get("items") or []],
            tenant_id=str(raw.get("tenant_id") or ""),
            owner=str(raw.get("owner") or ""),
        )


def list_predefined_lists(tenant_id: str, owner: str) -> List[PredefinedList]:
    """This person's predefined lists, newest first."""
    lists = (PredefinedList.from_dict(row) for row in read_predefined_lists())
    mine = (item for item in lists if item.belongs_to(tenant_id, owner))
    return sorted(mine, key=lambda l: l.id, reverse=True)


def create_predefined_list(tenant_id: str, owner: str,
                           name: str, items: List[str]) -> PredefinedList:
    """Append a new predefined list for this person and return it."""
    with storage_lock:
        rows = read_predefined_lists()
        made = PredefinedList(id=_next_id(rows), name=name, items=list(items),
                              tenant_id=tenant_id, owner=owner)
        rows.append(made.to_dict())
        write_predefined_lists(rows)
    return made


def update_predefined_list(tenant_id: str, owner: str, list_id: int,
                           name: Optional[str],
                           items: Optional[List[str]]) -> Optional[PredefinedList]:
    """Update one of this person's lists. None if there is no such list of theirs."""
    with storage_lock:
        rows = read_predefined_lists()
        for index, row in enumerate(rows):
            current = PredefinedList.from_dict(row)
            if current.id != list_id or not current.belongs_to(tenant_id, owner):
                continue

            if name is not None:
                current.name = name
            if items is not None:
                current.items = list(items)

            rows[index] = current.to_dict()
            write_predefined_lists(rows)
            return current
    return None


def delete_predefined_list(tenant_id: str, owner: str, list_id: int) -> bool:
    """Delete one of this person's lists. False if there is no such list of theirs."""
    with storage_lock:
        rows = read_predefined_lists()
        remaining = [
            row for row in rows
            if not (int(row["id"]) == list_id
                    and PredefinedList.from_dict(row).belongs_to(tenant_id, owner))
        ]
        if len(remaining) == len(rows):
            return False

        write_predefined_lists(remaining)
    return True
