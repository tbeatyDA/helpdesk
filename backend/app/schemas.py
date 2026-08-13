from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    upn: str
    display_name: str
    email: str
    role: str
    is_active: bool


def _validate_mailbox_email(v: Optional[str]) -> Optional[str]:
    """Empty string means "clear it" (handled by callers via model_fields_set,
    since None alone can't distinguish "not provided" from "clear it" in a
    PATCH); a real value must look like an email address."""
    if v is None or v == "":
        return None
    v = v.strip().lower()
    if "@" not in v or v.startswith("@") or v.endswith("@") or " " in v:
        raise ValueError("mailbox_email must be a valid email address")
    return v


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    visible_columns: Optional[list[str]]
    mailbox_email: Optional[str]


class DepartmentCreate(BaseModel):
    name: str
    slug: str
    visible_columns: Optional[list[str]] = None
    mailbox_email: Optional[str] = None

    @field_validator("slug")
    @classmethod
    def slug_must_be_slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not v or not all(c.isalnum() or c == "-" for c in v):
            raise ValueError("slug must be lowercase letters, numbers, and hyphens only")
        return v

    @field_validator("mailbox_email")
    @classmethod
    def mailbox_email_valid(cls, v: Optional[str]) -> Optional[str]:
        return _validate_mailbox_email(v)


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    visible_columns: Optional[list[str]] = None
    mailbox_email: Optional[str] = None

    @field_validator("mailbox_email")
    @classmethod
    def mailbox_email_valid(cls, v: Optional[str]) -> Optional[str]:
        return _validate_mailbox_email(v)


class DepartmentMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    department_id: int
    user_id: int
    user: UserOut


class DepartmentMembershipOut(BaseModel):
    """A department as seen from the member's own side (via /me) — no need
    for the join-row id, just what the frontend needs to render a picker."""

    id: int
    name: str
    slug: str
    visible_columns: Optional[list[str]]


class MeOut(UserOut):
    """Richer response for /me only. Kept separate from UserOut, which is
    embedded in ticket responses (assigned_to) — those shouldn't carry
    department data repeated once per ticket row."""

    departments: list[DepartmentMembershipOut]


class AdminUserOut(UserOut):
    """User list for the admin page — includes department memberships."""

    departments: list[DepartmentMembershipOut]


class AdminUserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("admin", "staff"):
            raise ValueError("role must be 'admin' or 'staff'")
        return v


class DepartmentMembershipCreate(BaseModel):
    department_id: int


class DepartmentAdminOut(DepartmentOut):
    """Departments list for the admin page — includes counts."""

    member_count: int
    ticket_count: int


class TicketMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: int
    direction: str
    from_email: str
    from_name: Optional[str]
    to_email: str
    subject: Optional[str]
    body_text: Optional[str]
    body_html: Optional[str]
    message_id: Optional[str]
    created_at: datetime


class TicketEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: int
    event_type: str
    old_value: Optional[str]
    new_value: Optional[str]
    note: Optional[str]
    actor_id: Optional[int]
    created_at: datetime


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: str
    subject: str
    status: str
    priority: str
    category: Optional[str]
    requester_email: str
    requester_name: Optional[str]
    assigned_to_id: Optional[int]
    assigned_to: Optional[UserOut]
    has_unread: bool
    email_received_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime]
    closed_at: Optional[datetime]
    messages: list[TicketMessageOut]
    events: list[TicketEventOut]


class TicketListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: str
    subject: str
    status: str
    priority: str
    category: Optional[str]
    requester_email: str
    requester_name: Optional[str]
    assigned_to_id: Optional[int]
    assigned_to: Optional[UserOut]
    has_unread: bool
    email_received_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    assigned_to_id: Optional[int] = None


class ReplyCreate(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def body_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("body must contain at least 1 character")
        return v
