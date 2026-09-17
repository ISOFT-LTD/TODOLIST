"""Pydantic schemas for the Todo plugin."""

from typing import Optional

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
