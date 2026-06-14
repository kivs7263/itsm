"""KB(지식베이스) 라우터.

prefix : /{tenant_slug}/kb
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/kb               — 목록 (is_published=true, 페이지네이션)
  POST   /{tenant_slug}/kb               — 작성 (engineer 이상)
  GET    /{tenant_slug}/kb/search?q=...  — 전문 검색 (Meilisearch) ← 고정 경로 먼저 등록
  GET    /{tenant_slug}/kb/{id}          — 상세
  PATCH  /{tenant_slug}/kb/{id}          — 수정 (engineer 이상)
  DELETE /{tenant_slug}/kb/{id}          — 삭제 (engineer 이상)

검색:
  - Meilisearch 사용 (graceful fallback: DB ILIKE로 폴백)
  - 작성/수정/삭제 시 인덱싱 비동기 호출 (실패 무시, 메인 저장 성공 우선)
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.kb_article import KbArticle
from app.models.user import User, UserRole
from app.services import search_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/kb",
    tags=["kb"],
)

# engineer 이상 권한 허용 역할
_WRITER_ROLES = {UserRole.engineer, UserRole.team_lead, UserRole.admin}


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class KbArticleCreate(BaseModel):
    title: str = Field(..., max_length=500)
    content: str = Field(..., min_length=1)
    tags: list[str] = Field(default_factory=list)
    linked_ticket_id: uuid.UUID | None = None
    is_published: bool = True


class KbArticleUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    content: str | None = Field(None, min_length=1)
    tags: list[str] | None = None
    linked_ticket_id: uuid.UUID | None = None
    is_published: bool | None = None


class KbArticleResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    content: str
    tags: list[str]
    linked_ticket_id: uuid.UUID | None
    author_id: uuid.UUID
    is_published: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


def _require_writer(current_user: User) -> None:
    """engineer 이상 역할 검증."""
    if current_user.role not in _WRITER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="작성/수정/삭제 권한이 없습니다.",
        )


def _to_kb_doc(article: KbArticle, author_name: str) -> search_service.KbDoc:
    return search_service.KbDoc(
        id=str(article.id),
        tenant_id=str(article.tenant_id),
        title=article.title,
        content=article.content,
        tags=article.tags or [],
        author_name=author_name,
        created_at=article.created_at.isoformat() if article.created_at else "",
    )


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="KB 문서 목록 (is_published=true, 페이지네이션)",
)
async def list_kb_articles(
    tenant_slug: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    offset = (page - 1) * limit
    base_where = and_(
        KbArticle.tenant_id == current_user.tenant_id,
        KbArticle.is_published.is_(True),
    )

    total = await db.scalar(
        select(func.count()).select_from(KbArticle).where(base_where)
    )
    rows = (
        await db.execute(
            select(KbArticle)
            .where(base_where)
            .order_by(KbArticle.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "items": [KbArticleResponse.model_validate(r) for r in rows],
    }


# ------------------------------------------------------------------
# 전문 검색 — /search 고정 경로를 /{id} 파라미터 경로보다 먼저 등록
# ------------------------------------------------------------------


@router.get(
    "/search",
    response_model=list[dict],
    summary="KB 전문 검색 (Meilisearch)",
)
async def search_kb_articles(
    tenant_slug: str,
    q: str = Query(..., min_length=1, description="검색어"),
    limit: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
) -> list[dict]:
    return await search_service.search_kb(
        str(current_user.tenant_id), q, limit
    )


# ------------------------------------------------------------------
# 작성
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=KbArticleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="KB 문서 작성 (engineer 이상)",
)
async def create_kb_article(
    tenant_slug: str,
    data: KbArticleCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> KbArticleResponse:
    _require_writer(current_user)

    article = KbArticle(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        title=data.title,
        content=data.content,
        tags=data.tags,
        linked_ticket_id=data.linked_ticket_id,
        author_id=current_user.id,
        is_published=data.is_published,
    )
    db.add(article)
    await db.commit()
    await db.refresh(article)

    # Meilisearch 인덱싱 (실패 무시)
    await search_service.index_kb(_to_kb_doc(article, current_user.name))

    # 시맨틱 임베딩 fire-and-forget (OPENAI_API_KEY 없으면 내부에서 조용히 skip)
    from app.routers.kb_semantic import _embed_article_async  # 순환 import 방지: 런타임 import
    asyncio.create_task(_embed_article_async(article.id, article.title, article.content))

    return KbArticleResponse.model_validate(article)


# ------------------------------------------------------------------
# 상세
# ------------------------------------------------------------------


@router.get(
    "/{kb_id}",
    response_model=KbArticleResponse,
    summary="KB 문서 상세",
)
async def get_kb_article(
    tenant_slug: str,
    kb_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> KbArticleResponse:
    article = await _get_or_404(db, current_user.tenant_id, kb_id)
    return KbArticleResponse.model_validate(article)


# ------------------------------------------------------------------
# 수정
# ------------------------------------------------------------------


@router.patch(
    "/{kb_id}",
    response_model=KbArticleResponse,
    summary="KB 문서 수정 (engineer 이상)",
)
async def update_kb_article(
    tenant_slug: str,
    kb_id: uuid.UUID,
    data: KbArticleUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> KbArticleResponse:
    _require_writer(current_user)
    article = await _get_or_404(db, current_user.tenant_id, kb_id)

    update_data = data.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(article, field, value)
    # 명시적 null 처리 (linked_ticket_id=null 허용)
    if "linked_ticket_id" in data.model_fields_set and data.linked_ticket_id is None:
        article.linked_ticket_id = None

    await db.commit()
    await db.refresh(article)

    # Meilisearch 갱신 (실패 무시)
    await search_service.index_kb(_to_kb_doc(article, current_user.name))

    # 시맨틱 임베딩 갱신 fire-and-forget
    from app.routers.kb_semantic import _embed_article_async  # 런타임 import
    asyncio.create_task(_embed_article_async(article.id, article.title, article.content))

    return KbArticleResponse.model_validate(article)


# ------------------------------------------------------------------
# 삭제
# ------------------------------------------------------------------


@router.delete(
    "/{kb_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="KB 문서 삭제 (engineer 이상)",
)
async def delete_kb_article(
    tenant_slug: str,
    kb_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    _require_writer(current_user)
    article = await _get_or_404(db, current_user.tenant_id, kb_id)

    await db.delete(article)
    await db.commit()

    # Meilisearch 삭제 (실패 무시)
    await search_service.delete_kb(str(current_user.tenant_id), str(kb_id))


# ------------------------------------------------------------------
# 내부 헬퍼
# ------------------------------------------------------------------


async def _get_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, kb_id: uuid.UUID
) -> KbArticle:
    """크로스 테넌트 → 404 (존재 노출 금지)."""
    row = (
        await db.execute(
            select(KbArticle).where(
                and_(
                    KbArticle.id == kb_id,
                    KbArticle.tenant_id == tenant_id,
                )
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KB 문서를 찾을 수 없습니다.")
    return row
