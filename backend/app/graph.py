from __future__ import annotations

import logging
import time
from typing import Optional

import httpx
import msal
from fastapi import HTTPException

from app.config import Settings

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"


class GraphMailClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

        if settings.o365_client_cert_path and settings.o365_client_cert_thumbprint:
            private_key = open(settings.o365_client_cert_path).read()
            credential = {
                "thumbprint": settings.o365_client_cert_thumbprint,
                "private_key": private_key,
            }
            logger.info("Using certificate credential for Graph auth")
        else:
            credential = settings.o365_client_secret
            logger.info("Using client secret for Graph auth")

        self._msal_app = msal.ConfidentialClientApplication(
            client_id=settings.o365_client_id,
            authority=f"https://login.microsoftonline.com/{settings.o365_tenant_id}",
            client_credential=credential,
        )
        self._cached_token: Optional[str] = None
        self._token_expiry: float = 0.0

    def _get_token(self) -> str:
        """Acquire an app-only access token using client credentials flow. Caches until expiry."""
        now = time.monotonic()
        if self._cached_token and now < self._token_expiry - 60:
            return self._cached_token

        scope = ["https://graph.microsoft.com/.default"]
        result = self._msal_app.acquire_token_for_client(scopes=scope)

        if "access_token" not in result:
            error = result.get("error", "unknown")
            desc = result.get("error_description", "")
            logger.error("Failed to acquire Graph token: %s — %s", error, desc)
            raise HTTPException(status_code=503, detail=f"Graph auth failed: {error}")

        self._cached_token = result["access_token"]
        # expires_in is in seconds; default to 3600
        expires_in = result.get("expires_in", 3600)
        self._token_expiry = now + float(expires_in)
        return self._cached_token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json",
        }

    def _raise_for_status(self, response: httpx.Response, context: str = "") -> None:
        if response.status_code >= 400:
            logger.error(
                "Graph API error%s: %s %s",
                f" ({context})" if context else "",
                response.status_code,
                response.text[:500],
            )
            raise HTTPException(
                status_code=502,
                detail=f"Graph API error {response.status_code}: {response.text[:200]}",
            )

    async def get_inline_attachments(self, mailbox: str, message_id: str) -> list[dict]:
        """Fetch inline attachments for a message (for embedding CID images).
        Graph does not support $filter on attachments, and $select rejects subtype-only fields
        like contentId — so fetch all fields and filter client-side."""
        url = f"{_GRAPH_BASE}/users/{mailbox}/messages/{message_id}/attachments"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, headers=self._headers())
        if response.status_code == 200:
            return [a for a in response.json().get("value", []) if a.get("isInline")]
        return []

    async def poll_unread_messages(self, mailbox: str, since: Optional[str] = None) -> list[dict]:
        """Fetch up to 50 messages newer than `since` (ISO-8601 UTC), oldest first.

        We filter by receivedDateTime rather than read state so that external systems
        (e.g. Freshdesk) marking mail as read don't hide messages from us. Duplicate
        suppression is handled by the caller via graph_id dedup in the DB.
        `since` should be an ISO-8601 UTC string like '2026-08-13T13:00:00Z'.
        """
        url = f"{_GRAPH_BASE}/users/{mailbox}/messages"
        params: dict = {
            "$orderby": "receivedDateTime asc",
            "$top": "50",
            "$select": (
                "id,subject,from,toRecipients,bodyPreview,body,hasAttachments,"
                "receivedDateTime,internetMessageId,internetMessageHeaders"
            ),
        }
        if since:
            params["$filter"] = f"receivedDateTime ge {since}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, headers=self._headers(), params=params)
        self._raise_for_status(response, "poll_unread_messages")
        data = response.json()
        return data.get("value", [])

    async def mark_read(self, mailbox: str, message_id: str) -> None:
        """Mark a single message as read."""
        url = f"{_GRAPH_BASE}/users/{mailbox}/messages/{message_id}"
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.patch(
                url,
                headers=self._headers(),
                json={"isRead": True},
            )
        self._raise_for_status(response, "mark_read")

    async def reply_to_message(
        self,
        mailbox: str,
        graph_message_id: str,
        body_html: str,
        subject: Optional[str] = None,
    ) -> dict:
        """Reply to a specific message using Graph's reply endpoint.
        Graph handles In-Reply-To/References threading headers automatically.
        Pass `subject` to override the default (original subject with Re: prepended)
        so the ticket number tag is preserved in the outgoing email."""
        url = f"{_GRAPH_BASE}/users/{mailbox}/messages/{graph_message_id}/reply"
        msg: dict = {
            "body": {
                "contentType": "HTML",
                "content": body_html,
            }
        }
        if subject:
            msg["subject"] = subject
        payload = {"message": msg}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=self._headers(), json=payload)
        self._raise_for_status(response, "reply_to_message")
        return {"status": "sent"}

    async def send_message(
        self,
        mailbox: str,
        to_email: str,
        to_name: str,
        subject: str,
        body_html: str,
    ) -> dict:
        """Send a new email from the given mailbox."""
        url = f"{_GRAPH_BASE}/users/{mailbox}/sendMail"
        payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "HTML",
                    "content": body_html,
                },
                "toRecipients": [
                    {
                        "emailAddress": {
                            "address": to_email,
                            "name": to_name,
                        }
                    }
                ],
            },
            "saveToSentItems": True,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=self._headers(), json=payload)
        self._raise_for_status(response, "send_message")
        return {"status": "sent"}
