from __future__ import annotations

import asyncio
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from bs4 import BeautifulSoup
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.graph import GraphMailClient
from app.helpers import _add_event, _next_ticket_number, _normalize_subject
from sqlalchemy import func

from app.models import SeenGraphId, Ticket, TicketMessage, User

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Graph client singleton — only created when O365 is configured
# ---------------------------------------------------------------------------

graph_client: Optional[GraphMailClient] = None
_poll_lock = asyncio.Lock()

if settings.o365_client_id and (settings.o365_client_secret or settings.o365_client_cert_path):
    graph_client = GraphMailClient(settings)
    logger.info("Graph mail client initialized for mailbox %s", settings.helpdesk_email)
else:
    logger.warning(
        "O365_CLIENT_ID not set — email polling and sending are disabled"
    )


# ---------------------------------------------------------------------------
# Email processing helpers
# ---------------------------------------------------------------------------


def _extract_header(headers: list[dict], name: str) -> Optional[str]:
    """Extract a named header value from the Graph internetMessageHeaders list."""
    name_lower = name.lower()
    for h in headers or []:
        if h.get("name", "").lower() == name_lower:
            return h.get("value")
    return None


def _strip_html(html: str) -> str:
    """Return plain text from HTML using BeautifulSoup."""
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator="\n").strip()


def _strip_quoted_reply(html: str) -> str:
    """Remove quoted reply history from an inbound HTML email body.

    Handles the most common formats:
    - Gmail: <div class="gmail_quote">
    - Outlook Web / OWA: <div id="divRplyFwdMsg">
    - Outlook Mobile: <div id="mail-editor-reference-message-container">
    - Outlook desktop: <hr> followed by reply headers (From/Sent/To/Subject)
    - Generic: <blockquote> elements
    """
    soup = BeautifulSoup(html, "html.parser")

    # Gmail quote block
    for el in soup.select("div.gmail_quote"):
        el.decompose()

    # Outlook Web / OWA reply wrapper
    for el in soup.select("#divRplyFwdMsg, #divRplyFwdMsg ~ *"):
        el.decompose()

    # Outlook Mobile reply container
    for el in soup.select("#mail-editor-reference-message-container"):
        el.decompose()

    # Outlook desktop: <hr> separator before quoted headers.
    # Find any <hr> after which a sibling contains "From:" or "Sent:" text
    # (the classic Outlook forwarded/reply block).
    for hr in soup.find_all("hr"):
        siblings = list(hr.find_next_siblings())
        text_after = " ".join(s.get_text() for s in siblings[:3])
        if any(kw in text_after for kw in ("From:", "Sent:", "To:", "Subject:")):
            for s in siblings:
                s.decompose()
            hr.decompose()
            break

    # Generic blockquotes (catches most remaining clients)
    for el in soup.find_all("blockquote"):
        el.decompose()

    return str(soup)


def _poll_since() -> str:
    """Return the ISO-8601 UTC timestamp to use as the lower bound for polling.

    Uses the most recent email_received_at across all tickets, minus a 5-minute
    buffer to tolerate clock skew. Falls back to today at midnight UTC so we never
    re-ingest years of history on a fresh install.
    """
    db = SessionLocal()
    try:
        latest: Optional[datetime] = db.query(func.max(Ticket.email_received_at)).scalar()
    finally:
        db.close()

    if latest:
        since = latest - timedelta(minutes=5)
    else:
        since = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    return since.strftime("%Y-%m-%dT%H:%M:%SZ")


async def process_new_emails() -> None:
    """Fetch emails newer than the last processed message and create/update tickets."""
    if graph_client is None:
        return
    if _poll_lock.locked():
        logger.debug("Poll already in progress, skipping.")
        return
    async with _poll_lock:
        since = _poll_since()
        try:
            messages = await graph_client.poll_unread_messages(settings.helpdesk_email, since)
        except Exception as exc:
            logger.error("Failed to poll mailbox: %s", exc)
            return

        if not messages:
            return

        logger.info("Processing %d unread message(s)", len(messages))

        db = SessionLocal()
        try:
            # Build a set of already-processed Graph message IDs from the persistent
            # seen-IDs table. This survives ticket deletion, preventing deleted tickets
            # from being recreated on the next poll.
            processed_ids: set[str] = {
                row[0] for row in db.query(SeenGraphId.graph_id).all()
            }

            for msg in messages:
                graph_msg_id: str = msg.get("id", "")

                if graph_msg_id in processed_ids:
                    logger.debug("Skipping already-processed message %s", graph_msg_id)
                    try:
                        await graph_client.mark_read(settings.helpdesk_email, graph_msg_id)
                    except Exception:
                        pass
                    continue

                # Parse sender
                from_obj = msg.get("from", {}).get("emailAddress", {})
                from_email: str = from_obj.get("address", "").strip().lower()
                from_name: str = from_obj.get("name", "").strip()

                # Skip messages sent BY the helpdesk to avoid loops
                if from_email == settings.helpdesk_email.lower():
                    logger.debug("Skipping message from self: %s", graph_msg_id)
                    await graph_client.mark_read(settings.helpdesk_email, graph_msg_id)
                    continue

                # Parse recipients
                to_recipients = msg.get("toRecipients", [])
                to_email: str = (
                    to_recipients[0].get("emailAddress", {}).get("address", "")
                    if to_recipients
                    else settings.helpdesk_email
                )

                # Parse internet headers
                inet_headers: list[dict] = msg.get("internetMessageHeaders", [])
                message_id: Optional[str] = (
                    msg.get("internetMessageId")
                    or _extract_header(inet_headers, "Message-ID")
                )
                in_reply_to: Optional[str] = _extract_header(inet_headers, "In-Reply-To")

                # Parse received timestamp
                received_dt_str: Optional[str] = msg.get("receivedDateTime")
                email_received_at: Optional[datetime] = None
                if received_dt_str:
                    try:
                        email_received_at = datetime.fromisoformat(
                            received_dt_str.replace("Z", "+00:00")
                        )
                    except ValueError:
                        pass

                # Parse subject
                raw_subject: str = (msg.get("subject") or "").strip()
                clean_subject: str = _normalize_subject(raw_subject) if raw_subject else ""

                # Parse body
                body_obj = msg.get("body", {})
                content_type: str = body_obj.get("contentType", "text").lower()
                raw_body: str = body_obj.get("content", "")

                if content_type == "html":
                    body_html: Optional[str] = _strip_quoted_reply(raw_body)
                    body_text: Optional[str] = _strip_html(body_html)
                else:
                    body_text = raw_body
                    body_html = None

                # Embed inline attachments as base64 data URIs.
                # Check for cid: references directly rather than relying on hasAttachments,
                # because Graph doesn't always set hasAttachments=true for inline-only images.
                if body_html and "cid:" in body_html:
                    try:
                        attachments = await graph_client.get_inline_attachments(
                            settings.helpdesk_email, graph_msg_id
                        )
                        for att in attachments:
                            cid = (att.get("contentId") or "").strip("<>")
                            b64 = att.get("contentBytes", "")
                            mime = att.get("contentType", "image/png")
                            if cid and b64:
                                body_html = body_html.replace(
                                    f"cid:{cid}", f"data:{mime};base64,{b64}",
                                )
                                body_html = body_html.replace(
                                    f"cid:<{cid}>", f"data:{mime};base64,{b64}",
                                )
                    except Exception as exc:
                        logger.warning("Failed to fetch inline attachments: %s", exc)

                # ------------------------------------------------------------------
                # Try to find an existing ticket
                # ------------------------------------------------------------------
                ticket: Optional[Ticket] = None

                # 1. Match by In-Reply-To → existing message_id (most reliable)
                if in_reply_to:
                    existing_msg = (
                        db.query(TicketMessage)
                        .filter(TicketMessage.message_id == in_reply_to)
                        .first()
                    )
                    if existing_msg:
                        ticket = db.query(Ticket).filter(Ticket.id == existing_msg.ticket_id).first()

                # 2. Match by ticket number tag in subject e.g. [HD-000001]
                if ticket is None:
                    tag_match = re.search(r"\[HD-(\d+)\]", raw_subject, re.IGNORECASE)
                    if tag_match:
                        ticket_number = f"HD-{int(tag_match.group(1)):06d}"
                        ticket = db.query(Ticket).filter(Ticket.number == ticket_number).first()

                # 3. Normalized subject match — same requester only, recent open tickets
                if ticket is None and clean_subject:
                    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=30)
                    recent_tickets = (
                        db.query(Ticket)
                        .filter(
                            Ticket.status.in_(["open", "in_progress", "pending"]),
                            Ticket.requester_email == from_email,
                            Ticket.created_at >= cutoff,
                        )
                        .all()
                    )
                    for candidate in recent_tickets:
                        if _normalize_subject(candidate.subject) == clean_subject:
                            ticket = candidate
                            break

                # 4. Create new ticket
                if ticket is None:
                    subject_for_ticket = (
                        re.sub(r"(?i)^\s*(re|fwd|fw)\s*:\s*", "", raw_subject).strip()
                        or raw_subject
                        or "(No Subject)"
                    )
                    ticket = Ticket(
                        number=_next_ticket_number(db),
                        subject=subject_for_ticket,
                        status="open",
                        priority="normal",
                        requester_email=from_email,
                        requester_name=from_name or None,
                        first_message_id=message_id,
                        email_received_at=email_received_at,
                    )
                    db.add(ticket)
                    db.flush()  # get ticket.id

                    _add_event(
                        db,
                        ticket_id=ticket.id,
                        event_type="created",
                        new_value=ticket.number,
                    )
                    logger.info(
                        "Created new ticket %s for %s — subject: %s",
                        ticket.number,
                        from_email,
                        ticket.subject,
                    )

                # ------------------------------------------------------------------
                # Add inbound message to the ticket
                # ------------------------------------------------------------------
                ticket.has_unread = True
                inbound = TicketMessage(
                    ticket_id=ticket.id,
                    direction="inbound",
                    from_email=from_email,
                    from_name=from_name or None,
                    to_email=to_email,
                    subject=raw_subject or None,
                    body_text=body_text,
                    body_html=body_html,
                    message_id=message_id,
                    in_reply_to=in_reply_to,
                    graph_id=graph_msg_id,
                )
                db.add(inbound)

                # Persist the graph_id so this message is never re-processed,
                # even if the ticket is later deleted.
                db.merge(SeenGraphId(graph_id=graph_msg_id))

                # Mark email as read
                try:
                    await graph_client.mark_read(settings.helpdesk_email, graph_msg_id)
                except Exception as exc:
                    logger.warning("Failed to mark message %s as read: %s", graph_msg_id, exc)

                db.commit()

        except Exception as exc:
            logger.error("Unexpected error in process_new_emails: %s", exc, exc_info=True)
            db.rollback()
        finally:
            db.close()


async def poll_loop() -> None:
    """Background task that polls for new emails on a fixed interval."""
    logger.info(
        "Email poll loop started (interval=%ds, mailbox=%s)",
        settings.helpdesk_poll_interval,
        settings.helpdesk_email,
    )
    while True:
        await asyncio.sleep(settings.helpdesk_poll_interval)
        try:
            await process_new_emails()
        except Exception as exc:
            logger.error("poll_loop iteration failed: %s", exc, exc_info=True)


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create helpdesk tables on startup (existing inventory tables are untouched)
    logger.info("Running table migrations...")
    Base.metadata.create_all(bind=engine)
    logger.info("Tables ready.")

    # Seed any configured users that haven't logged in yet
    all_upns = set(settings.admin_users_list) | set(settings.allowed_users_list)
    if all_upns:
        db = SessionLocal()
        try:
            for upn in all_upns:
                if not db.query(User).filter(User.upn == upn).first():
                    display_name = upn.split("@")[0].replace(".", " ").title()
                    role = "admin" if upn in settings.admin_users_list else "staff"
                    db.add(User(upn=upn, display_name=display_name, email=upn, role=role, is_active=True))
                    logger.info("Seeded user %s", upn)
            db.commit()
        finally:
            db.close()

    # Launch background email poller
    poll_task = asyncio.create_task(poll_loop())
    logger.info("Background email poller started.")

    yield

    poll_task.cancel()
    try:
        await poll_task
    except asyncio.CancelledError:
        pass
    logger.info("Background email poller stopped.")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Day Air IT Helpdesk API", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key,
    max_age=settings.session_max_age_seconds,
    https_only=settings.environment == "production",
    same_site="lax",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

from app.auth import router as auth_router  # noqa: E402
from app.routers.tickets import router as tickets_router, users_router, assets_router  # noqa: E402

app.include_router(auth_router)
app.include_router(tickets_router)
app.include_router(users_router)
app.include_router(assets_router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# On-demand poll trigger
# ---------------------------------------------------------------------------

from app.auth import current_user as _current_user  # noqa: E402 (already imported via router)
from app.database import get_db as _get_db  # noqa: E402
from fastapi import Depends as _Depends  # noqa: E402


@app.post("/api/tickets/poll")
async def trigger_poll(
    user: "User" = _Depends(_current_user),
):
    """Immediately poll for new emails. Called by the frontend refresh button."""
    await process_new_emails()
    return {"ok": True}
