"""답변 템플릿 라우터.

prefix: /{tenant_slug}/reply-templates

인증: get_current_user (JWT HttpOnly 쿠키)
격리: 모든 쿼리 tenant_id == current_user.tenant_id

가시성:
  - is_shared=True 인 템플릿은 같은 테넌트의 모든 사용자에게 노출
  - is_shared=False 인 템플릿은 본인(author_id)만 조회 가능

엔드포인트:
  GET    /{slug}/reply-templates           — 목록 (category 필터, is_shared or 본인 author)
  POST   /{slug}/reply-templates           — 생성
  PUT    /{slug}/reply-templates/{id}      — 수정 (본인 or team_lead+)
  DELETE /{slug}/reply-templates/{id}      — 삭제 (본인 or team_lead+)
  POST   /{slug}/reply-templates/{id}/use  — use_count +1
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import ReplyTemplate, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reply-templates"])

# team_lead 이상 역할
_LEAD_ROLES = (UserRole.team_lead, UserRole.admin)


# ──────────────────────────────────────────────────────────────────────────────
# 스키마
# ──────────────────────────────────────────────────────────────────────────────

class ReplyTemplateCreate(BaseModel):
    name: str
    body: str
    category: str | None = None
    is_shared: bool = True


class ReplyTemplateUpdate(BaseModel):
    name: str | None = None
    body: str | None = None
    category: str | None = None
    is_shared: bool | None = None


class ReplyTemplateOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    body: str
    category: str | None
    is_shared: bool
    author_id: uuid.UUID | None
    use_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ──────────────────────────────────────────────────────────────────────────────
# 엔드포인트
# ──────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{tenant_slug}/reply-templates",
    response_model=list[ReplyTemplateOut],
)
async def list_reply_templates(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    category: str | None = Query(None, description="카테고리 필터"),
):
    """답변 템플릿 목록 조회.

    is_shared=True 또는 본인이 작성한(author_id) 템플릿만 반환.
    """
    filters = [
        ReplyTemplate.tenant_id == current_user.tenant_id,
        or_(
            ReplyTemplate.is_shared.is_(True),
            ReplyTemplate.author_id == current_user.id,
        ),
    ]
    if category is not None:
        filters.append(ReplyTemplate.category == category)

    result = await db.execute(
        select(ReplyTemplate)
        .where(*filters)
        .order_by(ReplyTemplate.name)
    )
    return result.scalars().all()


@router.post(
    "/{tenant_slug}/reply-templates",
    response_model=ReplyTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_reply_template(
    tenant_slug: str,
    body: ReplyTemplateCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """답변 템플릿 생성."""
    template = ReplyTemplate(
        tenant_id=current_user.tenant_id,
        name=body.name,
        body=body.body,
        category=body.category,
        is_shared=body.is_shared,
        author_id=current_user.id,
        use_count=0,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.put(
    "/{tenant_slug}/reply-templates/{template_id}",
    response_model=ReplyTemplateOut,
)
async def update_reply_template(
    tenant_slug: str,
    template_id: uuid.UUID,
    body: ReplyTemplateUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """답변 템플릿 수정 (본인 또는 team_lead+)."""
    template = await _get_template_or_404(db, template_id, current_user.tenant_id)
    _assert_edit_permission(template, current_user)

    update_data = body.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    template.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(template)
    return template


@router.delete(
    "/{tenant_slug}/reply-templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_reply_template(
    tenant_slug: str,
    template_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """답변 템플릿 삭제 (본인 또는 team_lead+)."""
    template = await _get_template_or_404(db, template_id, current_user.tenant_id)
    _assert_edit_permission(template, current_user)

    await db.delete(template)
    await db.commit()


@router.post(
    "/{tenant_slug}/reply-templates/{template_id}/use",
    response_model=ReplyTemplateOut,
)
async def use_reply_template(
    tenant_slug: str,
    template_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """답변 템플릿 사용 횟수 +1."""
    template = await _get_template_or_404(db, template_id, current_user.tenant_id)

    # 접근 가능한 템플릿인지 확인 (is_shared 또는 본인 작성)
    if not template.is_shared and template.author_id != current_user.id:
        raise HTTPException(status_code=404, detail="답변 템플릿을 찾을 수 없습니다.")

    template.use_count = (template.use_count or 0) + 1
    await db.commit()
    await db.refresh(template)
    return template


# ──────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ──────────────────────────────────────────────────────────────────────────────

async def _get_template_or_404(
    db: AsyncSession,
    template_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ReplyTemplate:
    """테넌트 격리 적용 단건 조회. 없으면 404."""
    result = await db.execute(
        select(ReplyTemplate).where(
            ReplyTemplate.id == template_id,
            ReplyTemplate.tenant_id == tenant_id,
        )
    )
    template = result.scalar_one_or_none()
    if template is None:
        raise HTTPException(status_code=404, detail="답변 템플릿을 찾을 수 없습니다.")
    return template


def _assert_edit_permission(template: ReplyTemplate, current_user: User) -> None:
    """본인 또는 team_lead+ 만 수정/삭제 가능. 아니면 403."""
    is_owner = template.author_id == current_user.id
    is_lead_or_above = current_user.role in _LEAD_ROLES
    if not (is_owner or is_lead_or_above):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인이 작성한 템플릿이거나 팀장 이상만 수정/삭제할 수 있습니다.",
        )
