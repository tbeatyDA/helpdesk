from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth import require_admin
from app.database import get_db
from app.models import Department, DepartmentMember, Ticket, User
from app.schemas import (
    AdminUserOut,
    AdminUserUpdate,
    DepartmentAdminOut,
    DepartmentCreate,
    DepartmentMembershipCreate,
    DepartmentUpdate,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Departments
# ---------------------------------------------------------------------------


@router.get("/departments", response_model=list[DepartmentAdminOut])
def list_departments(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    departments = db.query(Department).order_by(Department.name).all()
    member_counts = dict(
        db.query(DepartmentMember.department_id, func.count(DepartmentMember.id))
        .group_by(DepartmentMember.department_id)
        .all()
    )
    ticket_counts = dict(
        db.query(Ticket.department_id, func.count(Ticket.id))
        .filter(Ticket.department_id.isnot(None))
        .group_by(Ticket.department_id)
        .all()
    )
    return [
        DepartmentAdminOut(
            id=d.id,
            name=d.name,
            slug=d.slug,
            visible_columns=d.visible_columns,
            mailbox_email=d.mailbox_email,
            member_count=member_counts.get(d.id, 0),
            ticket_count=ticket_counts.get(d.id, 0),
        )
        for d in departments
    ]


@router.post("/departments", response_model=DepartmentAdminOut, status_code=201)
def create_department(
    body: DepartmentCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if db.query(Department).filter(Department.slug == body.slug).first():
        raise HTTPException(status_code=409, detail=f"Slug '{body.slug}' is already in use")
    if body.mailbox_email and db.query(Department).filter(Department.mailbox_email == body.mailbox_email).first():
        raise HTTPException(status_code=409, detail=f"Mailbox '{body.mailbox_email}' is already assigned to another department")
    dept = Department(
        name=body.name, slug=body.slug, visible_columns=body.visible_columns,
        mailbox_email=body.mailbox_email,
    )
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return DepartmentAdminOut(
        id=dept.id, name=dept.name, slug=dept.slug, visible_columns=dept.visible_columns,
        mailbox_email=dept.mailbox_email, member_count=0, ticket_count=0,
    )


@router.patch("/departments/{department_id}", response_model=DepartmentAdminOut)
def update_department(
    department_id: int,
    body: DepartmentUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    dept = db.query(Department).filter(Department.id == department_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    if body.slug is not None and body.slug != dept.slug:
        if db.query(Department).filter(Department.slug == body.slug, Department.id != department_id).first():
            raise HTTPException(status_code=409, detail=f"Slug '{body.slug}' is already in use")
        dept.slug = body.slug
    if body.name is not None:
        dept.name = body.name
    if body.visible_columns is not None:
        dept.visible_columns = body.visible_columns
    # mailbox_email uses model_fields_set (not "is not None") so an explicit
    # empty string can clear it — None alone can't distinguish "field omitted"
    # from "field cleared" once the validator normalizes "" to None.
    if "mailbox_email" in body.model_fields_set:
        if body.mailbox_email and db.query(Department).filter(
            Department.mailbox_email == body.mailbox_email, Department.id != department_id
        ).first():
            raise HTTPException(status_code=409, detail=f"Mailbox '{body.mailbox_email}' is already assigned to another department")
        dept.mailbox_email = body.mailbox_email

    db.commit()
    db.refresh(dept)

    member_count = db.query(func.count(DepartmentMember.id)).filter_by(department_id=dept.id).scalar()
    ticket_count = db.query(func.count(Ticket.id)).filter_by(department_id=dept.id).scalar()
    return DepartmentAdminOut(
        id=dept.id, name=dept.name, slug=dept.slug, visible_columns=dept.visible_columns,
        mailbox_email=dept.mailbox_email, member_count=member_count, ticket_count=ticket_count,
    )


@router.delete("/departments/{department_id}", status_code=204)
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    dept = db.query(Department).filter(Department.id == department_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    if db.query(Department).count() <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only remaining department")
    db.delete(dept)
    db.commit()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    users = (
        db.query(User)
        .options(joinedload(User.department_memberships).joinedload(DepartmentMember.department))
        .order_by(User.display_name)
        .all()
    )
    return [
        AdminUserOut(
            id=u.id, upn=u.upn, display_name=u.display_name, email=u.email,
            role=u.role, is_active=u.is_active,
            departments=[
                {
                    "id": m.department.id,
                    "name": m.department.name,
                    "slug": m.department.slug,
                    "visible_columns": m.department.visible_columns,
                }
                for m in u.department_memberships
            ],
        )
        for u in users
    ]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: int,
    body: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = (
        db.query(User)
        .options(joinedload(User.department_memberships).joinedload(DepartmentMember.department))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.role is not None:
        if user.id == admin.id and body.role != "admin":
            raise HTTPException(status_code=400, detail="You can't remove your own admin role")
        user.role = body.role
    if body.is_active is not None:
        if user.id == admin.id and not body.is_active:
            raise HTTPException(status_code=400, detail="You can't deactivate your own account")
        user.is_active = body.is_active

    db.commit()
    db.refresh(user)
    return AdminUserOut(
        id=user.id, upn=user.upn, display_name=user.display_name, email=user.email,
        role=user.role, is_active=user.is_active,
        departments=[
            {
                "id": m.department.id,
                "name": m.department.name,
                "slug": m.department.slug,
                "visible_columns": m.department.visible_columns,
            }
            for m in user.department_memberships
        ],
    )


@router.post("/users/{user_id}/departments", status_code=201)
def add_department_membership(
    user_id: int,
    body: DepartmentMembershipCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    if not db.query(Department).filter(Department.id == body.department_id).first():
        raise HTTPException(status_code=404, detail="Department not found")
    exists = (
        db.query(DepartmentMember)
        .filter_by(user_id=user_id, department_id=body.department_id)
        .first()
    )
    if exists:
        return {"ok": True}
    db.add(DepartmentMember(user_id=user_id, department_id=body.department_id))
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/departments/{department_id}", status_code=204)
def remove_department_membership(
    user_id: int,
    department_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    membership = (
        db.query(DepartmentMember)
        .filter_by(user_id=user_id, department_id=department_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Membership not found")
    db.delete(membership)
    db.commit()
