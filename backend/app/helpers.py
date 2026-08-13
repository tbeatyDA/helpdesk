from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Department, DepartmentMember, Ticket, TicketEvent, User


def _auto_assign_default_department(db: Session, user: User) -> None:
    """If exactly one department exists, add a newly created user to it —
    keeps today's "everyone sees everything" behavior for single-department
    deployments. Once a second department exists, which department a new
    hire belongs to is no longer obvious, so that becomes an explicit admin
    action instead (via the admin page) rather than a guess made here.
    """
    departments = db.query(Department).all()
    if len(departments) == 1:
        db.add(DepartmentMember(department_id=departments[0].id, user_id=user.id))
        db.commit()


def _next_ticket_number(db: Session) -> str:
    """Generate the next sequential ticket number in HD-NNNNNN format."""
    row = db.query(func.max(Ticket.number)).scalar()
    if row:
        # Extract trailing digits from e.g. "HD-000042"
        match = re.search(r"(\d+)$", row)
        next_n = (int(match.group(1)) + 1) if match else 1
    else:
        next_n = 1
    return f"HD-{next_n:06d}"


def _add_event(
    db: Session,
    ticket_id: int,
    event_type: str,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    note: Optional[str] = None,
    actor_id: Optional[int] = None,
) -> TicketEvent:
    """Create a TicketEvent and add it to the session (caller must commit)."""
    event = TicketEvent(
        ticket_id=ticket_id,
        event_type=event_type,
        old_value=old_value,
        new_value=new_value,
        note=note,
        actor_id=actor_id,
    )
    db.add(event)
    return event


_REPLY_PREFIX_RE = re.compile(r"(?i)^\s*(?:(?:re|fwd?)\s*:\s*)+")


def _strip_reply_prefixes(subject: str) -> str:
    """Strip any number of leading Re:/Fw:/Fwd: prefixes.

    Forwarding a reply stacks prefixes (e.g. "Fwd: Re: blah"). A regex that only
    strips one pass leaves a mismatched leftover prefix, which breaks the fuzzy
    subject match in _normalize_subject below and causes duplicate tickets.
    """
    return _REPLY_PREFIX_RE.sub("", subject or "")


def _normalize_subject(subject: str) -> str:
    """Strip reply/forward prefixes, ticket numbers, and whitespace for fuzzy matching."""
    s = _strip_reply_prefixes(subject)
    # Remove ticket number tags like [HD-000001]
    s = re.sub(r"\[HD-\d+\]", "", s, flags=re.IGNORECASE)
    return s.strip().lower()
