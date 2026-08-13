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
