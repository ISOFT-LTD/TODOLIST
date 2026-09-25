"""Pydantic schemas for the Todo plugin: todos and predefined lists."""

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _clean_title(value: Optional[str]) -> Optional[str]:
    """Trim surrounding whitespace and reject titles that are blank."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("title must not be empty")
    return value


class TodoBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255, description="Todo title")

    _strip_title = field_validator("title")(_clean_title)


class TodoCreate(TodoBase):
    """Payload for creating a todo."""


class TodoUpdate(BaseModel):
    """Payload for updating a todo. Both fields are optional."""

    title: Optional[str] = Field(None, min_length=1, max_length=255, description="Todo title")
    done: Optional[bool] = Field(None, description="Completion state")

    _strip_title = field_validator("title")(_clean_title)


class TodoOut(BaseModel):
    """Todo as returned by the API."""

    id: int
    title: str
    done: bool

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Predefined lists
# ---------------------------------------------------------------------------


def _clean_name(value: Optional[str]) -> Optional[str]:
    """Trim surrounding whitespace and reject names that are blank."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("name must not be empty")
    return value


def _clean_items(items: Optional[List[str]]) -> Optional[List[str]]:
    """Trim every item and reject a list that is empty or has a blank item."""
    if items is None:
        return None
    cleaned = [item.strip() for item in items]
    if not cleaned:
        raise ValueError("items must not be empty")
    if any(not item for item in cleaned):
        raise ValueError("items must not contain blank entries")
    if any(len(item) > 255 for item in cleaned):
        raise ValueError("each item must be at most 255 characters")
    return cleaned


class PredefinedListCreate(BaseModel):
    """Payload for creating a predefined list."""

    name: str = Field(..., min_length=1, max_length=255, description="List name")
    items: List[str] = Field(..., min_length=1, max_length=200,
                             description="The todo titles this list would create")

    _strip_name = field_validator("name")(_clean_name)
    _strip_items = field_validator("items")(_clean_items)


class PredefinedListUpdate(BaseModel):
    """Payload for updating a predefined list. Both fields are optional."""

    name: Optional[str] = Field(None, min_length=1, max_length=255, description="List name")
    items: Optional[List[str]] = Field(None, min_length=1, max_length=200,
                                       description="The todo titles this list would create")

    _strip_name = field_validator("name")(_clean_name)
    _strip_items = field_validator("items")(_clean_items)


class PredefinedListOut(BaseModel):
    """Predefined list as returned by the API."""

    id: int
    name: str
    items: List[str]

    model_config = ConfigDict(from_attributes=True)
