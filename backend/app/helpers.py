from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Ticket, TicketEvent


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


def _normalize_subject(subject: str) -> str:
    """Strip reply/forward prefixes, ticket numbers, and whitespace for fuzzy matching."""
    s = subject or ""
    # Remove common reply/forward prefixes (case-insensitive, possibly repeated)
    s = re.sub(r"(?i)^\s*(re|fwd|fw)\s*:\s*", "", s, flags=re.IGNORECASE)
    # Remove ticket number tags like [HD-000001]
    s = re.sub(r"\[HD-\d+\]", "", s, flags=re.IGNORECASE)
    return s.strip().lower()
