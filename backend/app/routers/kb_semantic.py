"""KB 시맨틱 검색 라우터 (pgvector cosine 유사도).

prefix : /{tenant_slug}/kb/search
태그   : ["kb"]

엔드포인트:
  GET /{tenant_slug}/kb/search/semantic
    - q: 검색어 (str, 필수)
    - limit: 결과 수 (int, 기본 5, 최대 20)

구현:
  1. OPENAI_API_KEY 없으면 503 즉시 반환
  2. OpenAI text-embedding-3-small (dim=1536) 임베딩 생성
  3. pgvector <=> 연산자로 cosine 거리 정렬 → similarity = 1 - distance
  4. tenant_id + is_published + embedding IS NOT NULL 필터 (멀티테넌트 격리)

fire-and-forget 임베딩 helper:
  _embed_article_async(article_id, title, content, db_url)
  kb.py의 create / update 엔드포인트에서 asyncio.create_task()로 호출.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.core.dependencies import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/kb/search",
    tags=["kb"],
)


# ------------------------------------------------------------------
# 응답 스키마
# ------------------------------------------------------------------


class SemanticSearchResult(BaseModel):
    id: uuid.UUID
    title: str
    content: str
    category: str | None
    similarity: float

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 내부 헬퍼 — 벡터 문자열 변환
# ------------------------------------------------------------------


def _vec_to_pg_str(vec: list[float]) -> str:
    """[0.1, 0.2, ...] 형식 문자열로 변환 (pgvector CAST(:vec AS vector) 바인드용)."""
    return "[" + ",".join(str(v) for v in vec) + "]"


# ------------------------------------------------------------------
# 임베딩 생성 helper
# ------------------------------------------------------------------


async def _get_embedding(text_input: str) -> list[float]:
    """OpenAI text-embedding-3-small 임베딩 반환."""
    import openai  # 선택 패키지 — 런타임 import

    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text_input,
    )
    return response.data[0].embedding


# ------------------------------------------------------------------
# fire-and-forget: KB 아티클 임베딩 업데이트
# (kb.py의 create / update 에서 asyncio.create_task()로 호출)
# ------------------------------------------------------------------


async def _embed_article_async(
    article_id: uuid.UUID,
    title: str,
    content: str,
) -> None:
    """KB 아티클 저장 후 비동기 임베딩 업데이트.

    - OPENAI_API_KEY 없으면 조용히 return (메인 저장 성공 유지)
    - 실패 시 logger.warning만 (예외 전파 X)
    - 새 DB 세션 직접 생성 (create_task 컨텍스트에서 원본 세션 재사용 금지)
    """
    if not settings.OPENAI_API_KEY:
        return

    try:
        embedding = await _get_embedding(f"{title}\n{content}")
        vec_str = _vec_to_pg_str(embedding)

        async with AsyncSessionLocal() as session:
            await session.execute(
                text(
                    "UPDATE kb_articles "
                    "SET embedding = CAST(:vec AS vector) "
                    "WHERE id = :id"
                ),
                {"vec": vec_str, "id": str(article_id)},
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("KB 임베딩 업데이트 실패 article_id=%s: %s", article_id, exc)


# ------------------------------------------------------------------
# 엔드포인트
# ------------------------------------------------------------------


@router.get(
    "/semantic",
    response_model=list[SemanticSearchResult],
    summary="KB 시맨틱 검색 (pgvector cosine 유사도)",
)
async def semantic_search_kb(
    tenant_slug: str,
    q: str = Query(..., min_length=1, description="검색어"),
    limit: int = Query(5, ge=1, le=20, description="결과 수 (최대 20)"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[SemanticSearchResult]:
    """KB 아티클을 시맨틱 유사도로 검색.

    OPENAI_API_KEY 미설정 시 503 반환 (graceful fallback).
    """
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="시맨틱 검색이 설정되지 않았습니다.",
        )

    try:
        embedding = await _get_embedding(q)
    except Exception as exc:
        logger.error("OpenAI 임베딩 생성 실패: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="임베딩 서비스에 연결할 수 없습니다.",
        )

    vec_str = _vec_to_pg_str(embedding)

    rows = (
        await db.execute(
            text(
                "SELECT id, title, content, NULL AS category, "
                "       1 - (embedding <=> CAST(:vec AS vector)) AS similarity "
                "FROM kb_articles "
                "WHERE tenant_id = :tid "
                "  AND is_published = true "
                "  AND embedding IS NOT NULL "
                "ORDER BY embedding <=> CAST(:vec AS vector) "
                "LIMIT :limit"
            ),
            {
                "vec": vec_str,
                "tid": str(current_user.tenant_id),
                "limit": limit,
            },
        )
    ).mappings().all()

    return [
        SemanticSearchResult(
            id=row["id"],
            title=row["title"],
            content=row["content"],
            category=row["category"],
            similarity=float(row["similarity"]),
        )
        for row in rows
    ]
