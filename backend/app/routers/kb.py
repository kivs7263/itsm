"""KB(지식베이스) 라우터.

prefix : /{tenant_slug}/kb
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/kb               — 목록 (is_published=true + 본인 미게시 포함)
  POST   /{tenant_slug}/kb               — 작성 (engineer 이상)
  GET    /{tenant_slug}/kb/search?q=...  — 전문 검색 (Meilisearch) ← 고정 경로 먼저 등록
  GET    /{tenant_slug}/kb/{id}          — 상세 (view_count 증가)
  PATCH  /{tenant_slug}/kb/{id}          — 수정 (engineer 이상)
  DELETE /{tenant_slug}/kb/{id}          — 삭제 (engineer 이상)
  POST   /{tenant_slug}/kb/{id}/vote     — 투표 (helpful/not_helpful)
  GET    /portal/{tenant_slug}/kb/search — 포털 공개 검색 (비인증)
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, text
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

# 포털 공개 검색 라우터 (비인증)
router_portal_kb = APIRouter(
    prefix="/portal/{tenant_slug}/kb",
    tags=["portal-kb"],
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
    author_name: str | None = None
    is_published: bool
    view_count: int = 0
    helpful_votes: int = 0
    not_helpful_votes: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class KbVoteRequest(BaseModel):
    vote: Literal["helpful", "not_helpful"]


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


def _require_writer(current_user: User) -> None:
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
# 목록 (KB-6: 본인 미게시 포함)
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="KB 문서 목록 (게시 + 본인 미게시)",
)
async def list_kb_articles(
    tenant_slug: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    offset = (page - 1) * limit

    # 게시 문서 + 본인(또는 admin) 미게시 문서 포함
    is_admin = current_user.role in {UserRole.admin}
    if is_admin:
        visibility = KbArticle.tenant_id == current_user.tenant_id
    else:
        visibility = and_(
            KbArticle.tenant_id == current_user.tenant_id,
            or_(
                KbArticle.is_published.is_(True),
                KbArticle.author_id == current_user.id,
            ),
        )

    total = await db.scalar(
        select(func.count()).select_from(KbArticle).where(visibility)
    )
    rows = (
        await db.execute(
            select(KbArticle)
            .where(visibility)
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
    response_model=dict,
    summary="KB 전문 검색 (Meilisearch)",
)
async def search_kb_articles(
    tenant_slug: str,
    q: str = Query(..., min_length=1, description="검색어"),
    limit: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
) -> dict:
    results = await search_service.search_kb(
        str(current_user.tenant_id), q, limit
    )
    return {"items": results, "total": len(results)}


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
        author_name=current_user.name,
        is_published=data.is_published,
    )
    db.add(article)
    await db.commit()
    await db.refresh(article)

    await search_service.index_kb(_to_kb_doc(article, current_user.name))

    from app.routers.kb_semantic import _embed_article_async
    asyncio.create_task(_embed_article_async(article.id, article.title, article.content))

    return KbArticleResponse.model_validate(article)


# ------------------------------------------------------------------
# 상세 (view_count 증가)
# ------------------------------------------------------------------


@router.get(
    "/{kb_id}",
    response_model=KbArticleResponse,
    summary="KB 문서 상세 (조회수 증가)",
)
async def get_kb_article(
    tenant_slug: str,
    kb_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> KbArticleResponse:
    article = await _get_or_404(db, current_user.tenant_id, kb_id)

    # 본인 또는 admin이 아닌 경우 미게시 문서 차단
    is_admin = current_user.role in {UserRole.admin}
    if not article.is_published and article.author_id != current_user.id and not is_admin:
        raise HTTPException(status_code=404, detail="KB 문서를 찾을 수 없습니다.")

    # view_count 원자적 증가
    await db.execute(
        text("UPDATE kb_articles SET view_count = view_count + 1 WHERE id = :id"),
        {"id": str(kb_id)},
    )
    await db.commit()
    await db.refresh(article)

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
    if "linked_ticket_id" in data.model_fields_set and data.linked_ticket_id is None:
        article.linked_ticket_id = None

    await db.commit()
    await db.refresh(article)

    await search_service.index_kb(_to_kb_doc(article, current_user.name))

    from app.routers.kb_semantic import _embed_article_async
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

    await search_service.delete_kb(str(current_user.tenant_id), str(kb_id))


# ------------------------------------------------------------------
# 투표 (helpful / not_helpful)
# ------------------------------------------------------------------


@router.post(
    "/{kb_id}/vote",
    response_model=dict,
    summary="KB 문서 투표 (helpful/not_helpful)",
)
async def vote_kb_article(
    tenant_slug: str,
    kb_id: uuid.UUID,
    data: KbVoteRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    article = await _get_or_404(db, current_user.tenant_id, kb_id)

    col = "helpful_votes" if data.vote == "helpful" else "not_helpful_votes"
    await db.execute(
        text(f"UPDATE kb_articles SET {col} = {col} + 1 WHERE id = :id"),
        {"id": str(kb_id)},
    )
    await db.commit()
    await db.refresh(article)

    return {
        "helpful_votes": article.helpful_votes,
        "not_helpful_votes": article.not_helpful_votes,
    }


# ------------------------------------------------------------------
# AI KB 초안 생성 (AI-5)
# ------------------------------------------------------------------


@router.post(
    "/generate-draft",
    summary="AI KB 초안 생성 (Claude haiku) — 해결된 티켓 내용 기반",
)
async def generate_kb_draft(
    tenant_slug: str,
    body: dict,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """body: {ticket_id} — 해당 티켓 제목·설명·댓글로 KB 초안 생성.
    ANTHROPIC_API_KEY 미설정 시 {"title": null, "content": null, "tags": []} 반환.
    """
    from app.services import ai_service
    from app.models.ticket import Ticket, TicketComment

    ticket_id_raw = body.get("ticket_id")
    if not ticket_id_raw:
        return {"title": None, "content": None, "tags": []}

    try:
        ticket_id = uuid.UUID(str(ticket_id_raw))
    except ValueError:
        return {"title": None, "content": None, "tags": []}

    ticket = (
        await db.execute(
            select(Ticket).where(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if ticket is None:
        return {"title": None, "content": None, "tags": []}

    comment_rows = (
        await db.execute(
            select(TicketComment.body)
            .where(
                TicketComment.ticket_id == ticket_id,
                TicketComment.is_internal.is_(False),
            )
            .order_by(TicketComment.created_at)
            .limit(10)
        )
    ).scalars().all()

    result = await ai_service.generate_kb_draft(
        ticket_title=ticket.title,
        ticket_description=ticket.description,
        comments=list(comment_rows),
    )
    return result or {"title": None, "content": None, "tags": []}


# ------------------------------------------------------------------
# 포털 공개 KB 검색 (비인증, KB-7)
# ------------------------------------------------------------------


class PortalKbResult(BaseModel):
    id: uuid.UUID
    title: str
    content: str
    tags: list[str]
    view_count: int
    created_at: datetime


@router_portal_kb.get(
    "/search",
    response_model=list[PortalKbResult],
    summary="포털 공개 KB 검색 (비인증)",
)
async def portal_kb_search(
    tenant_slug: str,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> list[PortalKbResult]:
    """고객 포털 비인증 KB 검색 — 게시된 문서만, tenant_slug 기준 격리.
    q 미전달 시 전체 게시 문서 반환 (view_count 내림차순).
    """
    from sqlalchemy import select as sa_select
    from app.models.tenant import Tenant

    tenant = (
        await db.execute(
            sa_select(Tenant).where(Tenant.slug == tenant_slug)
        )
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="테넌트를 찾을 수 없습니다.")

    where_conds = [
        KbArticle.tenant_id == tenant.id,
        KbArticle.is_published.is_(True),
    ]
    if q and q.strip():
        q_lower = q.strip().lower()
        where_conds.append(
            or_(
                func.lower(KbArticle.title).contains(q_lower),
                func.lower(KbArticle.content).contains(q_lower),
            )
        )

    rows = (
        await db.execute(
            sa_select(KbArticle)
            .where(and_(*where_conds))
            .order_by(KbArticle.view_count.desc())
            .limit(limit)
        )
    ).scalars().all()

    return [
        PortalKbResult(
            id=r.id,
            title=r.title,
            content=r.content[:300] + "..." if len(r.content) > 300 else r.content,
            tags=r.tags or [],
            view_count=r.view_count or 0,
            created_at=r.created_at,
        )
        for r in rows
    ]


# ------------------------------------------------------------------
# 내부 헬퍼
# ------------------------------------------------------------------


async def _get_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, kb_id: uuid.UUID
) -> KbArticle:
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
