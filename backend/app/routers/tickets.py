from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.auth import current_user
from app.config import settings
from app.database import get_db
from app.helpers import _add_event, _next_ticket_number, _normalize_subject
from app.models import DepartmentMember, Ticket, TicketEvent, TicketMessage, User
from app.schemas import BulkDeleteRequest, ReplyCreate, TicketListItem, TicketOut, TicketUpdate, UserOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


# ---------------------------------------------------------------------------
# List active users (for assignment dropdown)
# ---------------------------------------------------------------------------

users_router = APIRouter(prefix="/api/users", tags=["users"])


@users_router.get("/", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return db.query(User).filter(User.is_active == True).order_by(User.display_name).all()


# ---------------------------------------------------------------------------
# List tickets
# ---------------------------------------------------------------------------


def _resolve_department_filter(db: Session, user: User, department_id: Optional[int]):
    """SQLAlchemy filter clause for Ticket.department_id, or None for "no filter".

    Admins with no department_id see everything (unchanged default). A non-admin
    with no department_id sees all of THEIR departments' tickets — for today's
    one-department world that's every ticket, same as before this existed. Shared
    by every endpoint that lists or counts tickets, so they can't drift apart.
    """
    if department_id is not None:
        if user.role != "admin":
            is_member = (
                db.query(DepartmentMember)
                .filter_by(user_id=user.id, department_id=department_id)
                .first()
            )
            if not is_member:
                raise HTTPException(status_code=403, detail="Not a member of that department")
        return Ticket.department_id == department_id
    elif user.role != "admin":
        member_dept_ids = [
            m.department_id
            for m in db.query(DepartmentMember).filter_by(user_id=user.id).all()
        ]
        return Ticket.department_id.in_(member_dept_ids)
    return None


@router.get("/", response_model=list[TicketListItem])
def list_tickets(
    status: Optional[str] = None,
    exclude_closed: bool = False,
    priority: Optional[str] = None,
    assigned_to_id: Optional[int] = None,
    department_id: Optional[int] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    query = db.query(Ticket).options(joinedload(Ticket.assigned_to))

    dept_filter = _resolve_department_filter(db, user, department_id)
    if dept_filter is not None:
        query = query.filter(dept_filter)

    if status:
        query = query.filter(Ticket.status == status)
    elif exclude_closed:
        query = query.filter(Ticket.status != "closed")
    if priority:
        query = query.filter(Ticket.priority == priority)
    if assigned_to_id is not None:
        query = query.filter(Ticket.assigned_to_id == assigned_to_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            Ticket.subject.ilike(like) | Ticket.requester_email.ilike(like)
        )

    tickets = (
        query.order_by(Ticket.updated_at.desc())
        .limit(200)
        .all()
    )
    return tickets


# ---------------------------------------------------------------------------
# Stats summary — must be registered BEFORE /{ticket_id} to avoid conflict
# ---------------------------------------------------------------------------


@router.get("/stats/summary")
def stats_summary(
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    query = db.query(Ticket.status, func.count(Ticket.id))
    dept_filter = _resolve_department_filter(db, user, department_id)
    if dept_filter is not None:
        query = query.filter(dept_filter)
    rows = query.group_by(Ticket.status).all()
    counts: dict[str, int] = {
        "total": 0,
        "open": 0,
        "in_progress": 0,
        "pending": 0,
        "resolved": 0,
        "closed": 0,
    }
    for row_status, count in rows:
        counts["total"] += count
        if row_status in counts:
            counts[row_status] = count
    return counts


# ---------------------------------------------------------------------------
# Ticket volume report — grouped by created date, by tech or whole department
# Must be registered BEFORE /{ticket_id} to avoid route conflict
# ---------------------------------------------------------------------------

_REPORT_LOOKBACK = {
    "week": timedelta(weeks=12),
    "month": timedelta(days=365),
    "year": timedelta(days=365 * 5),
}


@router.get("/stats/report")
def stats_report(
    interval: str = "month",
    group_by: str = "department",
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if interval not in _REPORT_LOOKBACK:
        raise HTTPException(status_code=400, detail="interval must be week, month, or year")
    if group_by not in ("tech", "department"):
        raise HTTPException(status_code=400, detail="group_by must be tech or department")

    since = datetime.now(tz=timezone.utc) - _REPORT_LOOKBACK[interval]
    period = func.date_trunc(interval, Ticket.created_at)

    rows_query = db.query(period.label("period"), func.count(Ticket.id).label("count")).filter(
        Ticket.created_at >= since
    )

    if group_by == "tech":
        rows = (
            rows_query.add_columns(Ticket.assigned_to_id, User.display_name)
            .outerjoin(User, User.id == Ticket.assigned_to_id)
            .group_by(period, Ticket.assigned_to_id, User.display_name)
            .order_by(period)
            .all()
        )
        series = [
            {
                "period": period_val.date().isoformat(),
                "key": str(tech_id) if tech_id is not None else "unassigned",
                "label": display_name or "Unassigned",
                "count": count,
            }
            for period_val, count, tech_id, display_name in rows
        ]
    else:
        rows = rows_query.group_by(period).order_by(period).all()
        series = [
            {
                "period": period_val.date().isoformat(),
                "key": "department",
                "label": "Whole Department",
                "count": count,
            }
            for period_val, count in rows
        ]

    return {"interval": interval, "group_by": group_by, "rows": series}


# ---------------------------------------------------------------------------
# Get single ticket
# ---------------------------------------------------------------------------


@router.get("/{ticket_id}", response_model=TicketOut)
def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    ticket = (
        db.query(Ticket)
        .options(
            selectinload(Ticket.messages),
            selectinload(Ticket.events),
            joinedload(Ticket.assigned_to),
        )
        .filter(Ticket.id == ticket_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Sort messages and events by created_at ascending
    ticket.messages.sort(key=lambda m: m.created_at)
    ticket.events.sort(key=lambda e: e.created_at)

    return ticket


# ---------------------------------------------------------------------------
# Update ticket
# ---------------------------------------------------------------------------


@router.patch("/{ticket_id}", response_model=TicketOut)
def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    ticket = (
        db.query(Ticket)
        .options(
            selectinload(Ticket.messages),
            selectinload(Ticket.events),
            joinedload(Ticket.assigned_to),
        )
        .filter(Ticket.id == ticket_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    now = datetime.now(tz=timezone.utc)

    if body.status is not None and body.status != ticket.status:
        old_status = ticket.status
        ticket.status = body.status
        if body.status == "resolved":
            ticket.resolved_at = now
        elif body.status == "closed":
            ticket.closed_at = now
        elif body.status in ("open", "in_progress"):
            # Reopening — clear resolved/closed timestamps
            ticket.resolved_at = None
            ticket.closed_at = None
        _add_event(
            db,
            ticket_id=ticket.id,
            event_type="status_changed",
            old_value=old_status,
            new_value=body.status,
            actor_id=user.id,
        )

    if body.priority is not None and body.priority != ticket.priority:
        old_priority = ticket.priority
        ticket.priority = body.priority
        _add_event(
            db,
            ticket_id=ticket.id,
            event_type="priority_changed",
            old_value=old_priority,
            new_value=body.priority,
            actor_id=user.id,
        )

    if body.category is not None and body.category != ticket.category:
        ticket.category = body.category

    if body.assigned_to_id is not None and body.assigned_to_id != ticket.assigned_to_id:
        ticket.assigned_to_id = body.assigned_to_id
        _add_event(
            db,
            ticket_id=ticket.id,
            event_type="assigned",
            new_value=str(body.assigned_to_id),
            actor_id=user.id,
        )

    db.commit()
    db.refresh(ticket)

    ticket.messages.sort(key=lambda m: m.created_at)
    ticket.events.sort(key=lambda e: e.created_at)

    return ticket


# ---------------------------------------------------------------------------
# Delete ticket(s)
# ---------------------------------------------------------------------------


@router.delete("/{ticket_id}", status_code=204)
def delete_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    db.delete(ticket)
    db.commit()


@router.delete("/", status_code=200)
def bulk_delete_tickets(
    body: BulkDeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not body.ids:
        return {"deleted": 0}
    deleted = (
        db.query(Ticket)
        .filter(Ticket.id.in_(body.ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


# ---------------------------------------------------------------------------
# Mark ticket as read
# ---------------------------------------------------------------------------


@router.post("/{ticket_id}/read", status_code=204)
def mark_ticket_read(
    ticket_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.has_unread:
        ticket.has_unread = False
        db.commit()


# ---------------------------------------------------------------------------
# Reply to ticket
# ---------------------------------------------------------------------------


@router.post("/{ticket_id}/reply", response_model=TicketOut)
async def reply_to_ticket(
    ticket_id: int,
    body: ReplyCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    from app.main import graph_client  # imported here to avoid circular import at module level

    ticket = (
        db.query(Ticket)
        .options(
            selectinload(Ticket.messages),
            selectinload(Ticket.events),
            joinedload(Ticket.assigned_to),
        )
        .filter(Ticket.id == ticket_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Find last inbound message — prefer Graph ID for threading
    inbound_messages = [m for m in ticket.messages if m.direction == "inbound"]
    last_inbound = inbound_messages[-1] if inbound_messages else None

    # Build reply subject — include ticket number so customer replies thread back correctly
    original_subject = ticket.subject or ""
    tag = f"[{ticket.number}]"
    base = re.sub(r"\[HD-\d+\]\s*", "", original_subject).strip()
    reply_subject = f"Re: {tag} {base}" if base else f"Re: {tag}"

    # Build HTML body with signature
    signature = (
        "<br><br>--<br>"
        "<strong>IT Helpdesk</strong>, Day Air Credit Union"
        " | <a href='mailto:helpdesk@dayair.org'>helpdesk@dayair.org</a>"
    )
    body_html = f'<div style="font-family:sans-serif">{body.body}</div>{signature}'

    if graph_client is None:
        raise HTTPException(status_code=503, detail="Email service not configured")

    if last_inbound and last_inbound.graph_id:
        # Use Graph's reply endpoint — threading headers handled automatically.
        # Explicitly set the subject so the [HD-XXXXXX] tag is included, which
        # lets us match the ticket if the user replies back.
        await graph_client.reply_to_message(
            mailbox=settings.helpdesk_email,
            graph_message_id=last_inbound.graph_id,
            body_html=body_html,
            subject=reply_subject,
        )
    else:
        # No original message to reply to — send as new message
        await graph_client.send_message(
            mailbox=settings.helpdesk_email,
            to_email=ticket.requester_email,
            to_name=ticket.requester_name or ticket.requester_email,
            subject=reply_subject,
            body_html=body_html,
        )

    # Store outbound message record
    outbound = TicketMessage(
        ticket_id=ticket.id,
        direction="outbound",
        from_email=settings.helpdesk_email,
        from_name="IT Helpdesk",
        to_email=ticket.requester_email,
        subject=reply_subject,
        body_text=body.body,
        body_html=body_html,
    )
    db.add(outbound)

    _add_event(
        db,
        ticket_id=ticket.id,
        event_type="message_sent",
        actor_id=user.id,
    )

    ticket.has_unread = False

    # Auto-advance status from open → in_progress
    if ticket.status == "open":
        ticket.status = "in_progress"
        _add_event(
            db,
            ticket_id=ticket.id,
            event_type="status_changed",
            old_value="open",
            new_value="in_progress",
            actor_id=user.id,
        )

    db.commit()
    db.refresh(ticket)

    ticket.messages.sort(key=lambda m: m.created_at)
    ticket.events.sort(key=lambda e: e.created_at)

    return ticket


# ---------------------------------------------------------------------------
# Assets lookup (queries shared inventory DB)
# ---------------------------------------------------------------------------

assets_router = APIRouter(prefix="/api/assets", tags=["assets"])


@assets_router.get("/by-upns")
def assets_by_upns(
    upns: str,  # comma-separated list of UPNs
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Return primary assigned asset info keyed by UPN, for showing in ticket queue."""
    from sqlalchemy import text

    upn_list = [u.strip().lower() for u in upns.split(",") if u.strip()]
    if not upn_list:
        return {}

    rows = db.execute(
        text(
            "SELECT id, name, asset_tag, category, brand, model, "
            "intune_device_name, ad_computer_name, assigned_to_upn "
            "FROM assets WHERE LOWER(assigned_to_upn) = ANY(:upns) AND status != 'Retired'"
        ),
        {"upns": upn_list},
    ).mappings().all()

    # Build map: upn → first (or primary) asset.
    result: dict = {}
    for row in rows:
        upn = (row["assigned_to_upn"] or "").lower()
        if upn in result:
            continue
        desc_parts = [p for p in [row["category"], row["brand"], row["model"]] if p]
        desc = " ".join(desc_parts) or None
        device_name = row["intune_device_name"] or row["ad_computer_name"] or None
        result[upn] = {
            "id": row["id"],
            "asset_tag": row["asset_tag"],
            "device_name": device_name,
            "name": row["name"] or desc,
        }

    return result
