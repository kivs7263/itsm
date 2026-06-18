"""AI 서비스 레이어 (ITSM-AI-1).

- classify_ticket: 티켓 제목/설명 → 우선순위·증상 카테고리 분류 제안 (Claude haiku)
- suggest_kb_articles: 티켓 내용 → 관련 KB Top K (OpenAI 임베딩 + pgvector)
- generate_kb_draft: 해결된 티켓 내용 → KB 초안 생성 (Claude haiku)

ANTHROPIC_API_KEY 미설정 → classify_ticket / generate_kb_draft graceful None 반환.
OPENAI_API_KEY 미설정 → suggest_kb_articles graceful 빈 리스트 반환.
"""
from __future__ import annotations

import json
import logging
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

logger = logging.getLogger(__name__)

_PRIORITY_VALUES = ("low", "medium", "high", "critical")


# ──────────────────────────────────────────────────────────────────
# 내부 헬퍼
# ──────────────────────────────────────────────────────────────────


def _claude_client():
    import anthropic
    return anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)


async def _call_claude(system: str, user: str) -> str | None:
    """Claude haiku 호출. 실패 시 None 반환 (graceful)."""
    if not settings.ANTHROPIC_API_KEY:
        return None
    try:
        client = _claude_client()
        msg = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=512,
            messages=[{"role": "user", "content": user}],
            system=system,
        )
        return msg.content[0].text if msg.content else None
    except Exception as exc:
        logger.warning("Claude API 호출 실패: %s", exc)
        return None


# ──────────────────────────────────────────────────────────────────
# classify_ticket
# ──────────────────────────────────────────────────────────────────


async def classify_ticket(
    title: str,
    description: str | None,
    tenant_id: uuid.UUID,
    db: AsyncSession,
) -> dict | None:
    """티켓 분류 제안.

    반환:
        {
            "priority": "high",
            "symptom_category_name": "네트워크 장애",
            "symptom_category_id": "uuid-or-null",
            "confidence": 0.85,
            "reason": "한줄 설명"
        }
    ANTHROPIC_API_KEY 미설정 시 None.
    """
    if not settings.ANTHROPIC_API_KEY:
        return None

    # 테넌트의 증상 카테고리 목록 조회 (최대 30개 — 프롬프트 크기 제한)
    rows = (
        await db.execute(
            text(
                "SELECT id, name FROM symptom_categories "
                "WHERE tenant_id = :tid AND parent_id IS NULL "
                "ORDER BY display_order LIMIT 30"
            ),
            {"tid": str(tenant_id)},
        )
    ).fetchall()
    categories = [{"id": str(r.id), "name": r.name} for r in rows]
    cat_json = json.dumps(categories, ensure_ascii=False)

    system_prompt = (
        "당신은 IT 서비스 관리(ITSM) 전문가입니다. "
        "티켓 제목과 설명을 읽고 우선순위와 증상 카테고리를 분류하세요.\n"
        "반드시 JSON만 반환하세요. 설명 텍스트 금지.\n"
        "JSON 스키마: "
        '{"priority": "low|medium|high|critical", '
        '"symptom_category_id": "UUID 또는 null", '
        '"symptom_category_name": "문자열 또는 null", '
        '"confidence": 0.0~1.0, '
        '"reason": "한줄 설명"}'
    )
    user_prompt = (
        f"티켓 제목: {title}\n"
        f"설명: {description or '없음'}\n\n"
        f"사용 가능한 증상 카테고리 목록 (JSON 배열):\n{cat_json}\n\n"
        "위 카테고리 중 가장 적합한 것을 선택하세요. "
        "적합한 카테고리가 없으면 symptom_category_id와 symptom_category_name을 null로 하세요."
    )

    raw = await _call_claude(system_prompt, user_prompt)
    if not raw:
        return None

    try:
        # 마크다운 코드블록 제거 후 파싱
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
        result = json.loads(cleaned.strip())

        # priority 값 검증
        if result.get("priority") not in _PRIORITY_VALUES:
            result["priority"] = "medium"

        # confidence float 보정
        try:
            result["confidence"] = float(result.get("confidence", 0.7))
        except (TypeError, ValueError):
            result["confidence"] = 0.7

        return result
    except Exception as exc:
        logger.warning("AI 분류 결과 파싱 실패: %s | raw=%r", exc, raw[:200])
        return None


# ──────────────────────────────────────────────────────────────────
# suggest_kb_articles (pgvector 재활용)
# ──────────────────────────────────────────────────────────────────


async def suggest_kb_articles(
    title: str,
    description: str | None,
    tenant_id: uuid.UUID,
    db: AsyncSession,
    top_k: int = 3,
) -> list[dict]:
    """관련 KB 아티클 Top K 반환.

    OpenAI 임베딩 + pgvector cosine 유사도 사용.
    OPENAI_API_KEY 미설정 또는 실패 시 빈 리스트.
    threshold: similarity >= 0.55 만 포함.
    """
    if not settings.OPENAI_API_KEY:
        return []

    try:
        from app.routers.kb_semantic import _get_embedding, _vec_to_pg_str
        query_text = f"{title}\n{description or ''}".strip()
        embedding = await _get_embedding(query_text)
        vec_str = _vec_to_pg_str(embedding)

        rows = (
            await db.execute(
                text(
                    "SELECT id, title, content, "
                    "       1 - (embedding <=> CAST(:vec AS vector)) AS similarity "
                    "FROM kb_articles "
                    "WHERE tenant_id = :tid "
                    "  AND is_published = true "
                    "  AND embedding IS NOT NULL "
                    "  AND 1 - (embedding <=> CAST(:vec AS vector)) >= 0.55 "
                    "ORDER BY embedding <=> CAST(:vec AS vector) "
                    "LIMIT :limit"
                ),
                {"vec": vec_str, "tid": str(tenant_id), "limit": top_k},
            )
        ).mappings().all()

        return [
            {
                "id": str(row["id"]),
                "title": row["title"],
                "content": (row["content"] or "")[:300],
                "similarity": round(float(row["similarity"]), 3),
            }
            for row in rows
        ]
    except Exception as exc:
        logger.warning("KB 유사도 검색 실패: %s", exc)
        return []


# ──────────────────────────────────────────────────────────────────
# generate_kb_draft
# ──────────────────────────────────────────────────────────────────


async def generate_kb_draft(
    ticket_title: str,
    ticket_description: str | None,
    comments: list[str],
) -> dict | None:
    """해결된 티켓 내용으로 KB 초안 생성.

    반환:
        {"title": "...", "content": "...", "tags": ["tag1", ...]}
    ANTHROPIC_API_KEY 미설정 시 None.
    """
    if not settings.ANTHROPIC_API_KEY:
        return None

    comments_text = "\n".join(f"- {c}" for c in comments[:10]) if comments else "없음"

    system_prompt = (
        "당신은 IT 서비스 관리(ITSM) 지식베이스 작성 전문가입니다. "
        "해결된 티켓 정보를 바탕으로 KB 문서 초안을 작성하세요.\n"
        "반드시 JSON만 반환하세요. 설명 텍스트 금지.\n"
        'JSON 스키마: {"title": "KB 문서 제목", "content": "마크다운 본문 (문제→원인→해결방법 구조)", '
        '"tags": ["태그1", "태그2"]}'
    )
    user_prompt = (
        f"티켓 제목: {ticket_title}\n"
        f"티켓 설명: {ticket_description or '없음'}\n\n"
        f"댓글/해결 메모:\n{comments_text}\n\n"
        "위 정보를 바탕으로 다른 엔지니어가 재활용할 수 있는 KB 문서를 작성하세요. "
        "본문은 ## 문제 / ## 원인 / ## 해결 방법 구조로 작성하세요."
    )

    raw = await _call_claude(system_prompt, user_prompt)
    if not raw:
        return None

    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
        result = json.loads(cleaned.strip())
        if not isinstance(result.get("tags"), list):
            result["tags"] = []
        return result
    except Exception as exc:
        logger.warning("AI KB 초안 파싱 실패: %s | raw=%r", exc, raw[:200])
        return None
