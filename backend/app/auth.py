from __future__ import annotations

import logging
from typing import Optional

import msal
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.helpers import _auto_assign_default_department
from app.models import DepartmentMember, User
from app.schemas import MeOut, UserOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

GRAPH_SCOPES = ["User.Read"]


def _build_msal_app(cache: Optional[msal.SerializableTokenCache] = None) -> msal.ConfidentialClientApplication:
    if settings.o365_client_cert_path and settings.o365_client_cert_thumbprint:
        credential = {
            "thumbprint": settings.o365_client_cert_thumbprint,
            "private_key": open(settings.o365_client_cert_path).read(),
        }
    else:
        credential = settings.o365_client_secret

    return msal.ConfidentialClientApplication(
        settings.o365_client_id,
        authority=f"https://login.microsoftonline.com/{settings.o365_tenant_id}",
        client_credential=credential,
        token_cache=cache,
    )


def _build_auth_url() -> str:
    app = _build_msal_app()
    return app.get_authorization_request_url(
        scopes=GRAPH_SCOPES,
        redirect_uri=settings.o365_redirect_uri,
    )


def _get_token_from_code(code: str) -> dict:
    app = _build_msal_app()
    result = app.acquire_token_by_authorization_code(
        code=code,
        scopes=GRAPH_SCOPES,
        redirect_uri=settings.o365_redirect_uri,
    )
    return result


def _get_or_create_user(db: Session, upn: str, display_name: str, email: str) -> User:
    user = db.query(User).filter(User.upn == upn.lower()).first()
    if not user:
        role = "admin" if upn.lower() in settings.admin_users_list else "staff"
        user = User(
            upn=upn.lower(),
            display_name=display_name,
            email=email,
            role=role,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        _auto_assign_default_department(db, user)
    elif not user.is_active:
        # The admin-users env var only seeds a brand-new user's initial role — once a
        # user row exists, role/is_active are admin-managed (see the admin page) and
        # login no longer resyncs them from the allowlist.
        raise HTTPException(status_code=403, detail="Account deactivated")
    return user


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/login")
def login(request: Request):
    if not settings.o365_client_id:
        raise HTTPException(status_code=503, detail="O365 authentication not configured")
    auth_url = _build_auth_url()
    return RedirectResponse(url=auth_url)


@router.get("/callback")
def callback(request: Request, code: str = None, error: str = None, db: Session = Depends(get_db)):
    if error:
        logger.error("OAuth callback error: %s", error)
        raise HTTPException(status_code=400, detail=f"OAuth error: {error}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    result = _get_token_from_code(code)

    if "error" in result:
        logger.error("Token acquisition failed: %s — %s", result.get("error"), result.get("error_description"))
        raise HTTPException(status_code=400, detail=result.get("error_description", "Token acquisition failed"))

    claims = result.get("id_token_claims", {})
    upn = claims.get("preferred_username") or claims.get("upn") or ""
    display_name = claims.get("name") or upn
    email = claims.get("email") or upn

    if not upn:
        raise HTTPException(status_code=400, detail="Could not determine user identity from token")

    # If allowed_users is configured, enforce it
    if settings.allowed_users_list and upn.lower() not in settings.allowed_users_list:
        raise HTTPException(status_code=403, detail="Access denied: user not in allowed list")

    user = _get_or_create_user(db, upn=upn, display_name=display_name, email=email)

    from sqlalchemy import func as sqlfunc
    user.last_login_at = sqlfunc.now()
    db.commit()

    request.session["user_id"] = user.id
    request.session["user_upn"] = user.upn
    request.session["user_role"] = user.role

    return RedirectResponse(url="/")


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return JSONResponse({"ok": True})


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    memberships = (
        db.query(DepartmentMember)
        .options(joinedload(DepartmentMember.department))
        .filter(DepartmentMember.user_id == user.id)
        .all()
    )
    return MeOut(
        id=user.id, upn=user.upn, display_name=user.display_name, email=user.email,
        role=user.role, is_active=user.is_active,
        departments=[
            {
                "id": m.department.id,
                "name": m.department.name,
                "slug": m.department.slug,
                "visible_columns": m.department.visible_columns,
            }
            for m in memberships
        ],
    )


# ---------------------------------------------------------------------------
# Dev login (disabled in production)
# ---------------------------------------------------------------------------


@router.post("/dev-login")
def dev_login(request: Request, upn: str, db: Session = Depends(get_db)):
    if settings.environment == "production":
        raise HTTPException(status_code=404, detail="Not found")

    user = db.query(User).filter(User.upn == upn.lower()).first()
    if not user:
        user = User(
            upn=upn.lower(),
            display_name=upn,
            email=upn,
            role="admin" if upn.lower() in settings.admin_users_list else "staff",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        _auto_assign_default_department(db, user)

    request.session["user_id"] = user.id
    request.session["user_upn"] = user.upn
    request.session["user_role"] = user.role

    return UserOut.model_validate(user)
