"""Meilisearch 검색 서비스 — 티켓 + KB 전문 검색.

멀티테넌트 인덱스 분리:
  - itsm_tickets_{tenant_id}: 티켓 검색
  - itsm_kb_{tenant_id}: KB 문서 검색

설계 원칙:
  - 모든 Meilisearch 오류 graceful fallback (로그만, 예외 미전파)
  - MEILISEARCH_API_KEY 미설정 시 자동 비활성
  - 인덱스 초기화는 멱등 (중복 호출 안전)
"""
from __future__ import annotations

import logging
from typing import TypedDict

import meilisearch

from app.core.config import settings

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Meilisearch 클라이언트 (모듈 수준 싱글톤)
# ------------------------------------------------------------------

_client: meilisearch.Client | None = None


def _get_client() -> meilisearch.Client | None:
    """Meilisearch 클라이언트 반환. 설정 미입력 시 None 반환."""
    global _client
    if _client is not None:
        return _client
    if not settings.MEILISEARCH_HOST:
        return None
    try:
        _client = meilisearch.Client(
            settings.MEILISEARCH_HOST,
            settings.MEILISEARCH_API_KEY or None,
        )
        return _client
    except Exception as exc:
        logger.warning("Meilisearch 클라이언트 초기화 실패: %s", exc)
        return None


# ------------------------------------------------------------------
# 문서 구조
# ------------------------------------------------------------------


class TicketDoc(TypedDict):
    id: str
    tenant_id: str
    title: str
    description: str
    status: str
    priority: str
    customer_name: str
    assignee_name: str
    created_at: str  # ISO 8601


class KbDoc(TypedDict):
    id: str
    tenant_id: str
    title: str
    content: str
    tags: list[str]
    author_name: str
    created_at: str  # ISO 8601


# ------------------------------------------------------------------
# 인덱스 이름 헬퍼
# ------------------------------------------------------------------


def _ticket_index_name(tenant_id: str) -> str:
    return f"itsm_tickets_{tenant_id}"


def _kb_index_name(tenant_id: str) -> str:
    return f"itsm_kb_{tenant_id}"


# ------------------------------------------------------------------
# 인덱스 초기화 (멱등)
# ------------------------------------------------------------------


async def init_indexes(tenant_id: str) -> None:
    """테넌트 진입 시 인덱스 + 설정 초기화 (멱등).

    tickets: 검색 가능 필드 = title, description, customer_name
    kb:      검색 가능 필드 = title, content, tags
    """
    client = _get_client()
    if client is None:
        return

    try:
        # tickets 인덱스
        tickets_name = _ticket_index_name(tenant_id)
        try:
            client.create_index(tickets_name, {"primaryKey": "id"})
        except meilisearch.errors.MeilisearchApiError as e:
            if "index_already_exists" not in str(e):
                raise
        client.index(tickets_name).update_searchable_attributes(
            ["title", "description", "customer_name"]
        )

        # kb 인덱스
        kb_name = _kb_index_name(tenant_id)
        try:
            client.create_index(kb_name, {"primaryKey": "id"})
        except meilisearch.errors.MeilisearchApiError as e:
            if "index_already_exists" not in str(e):
                raise
        client.index(kb_name).update_searchable_attributes(
            ["title", "content", "tags"]
        )
    except Exception as exc:
        logger.warning("Meilisearch 인덱스 초기화 실패 (tenant=%s): %s", tenant_id, exc)


# ------------------------------------------------------------------
# 티켓 인덱싱
# ------------------------------------------------------------------


async def index_ticket(ticket: TicketDoc) -> None:
    """티켓 upsert 인덱싱."""
    client = _get_client()
    if client is None:
        return
    try:
        # primary_key 명시 필수: doc에 'id'·'tenant_id' 2개 *id 필드가 있어
        # PK 추론이 실패한다(index_primary_key_multiple_candidates_found).
        # 인덱스가 PK 없이 자동생성된 경우에도 빈 인덱스면 여기서 PK가 설정된다.
        client.index(_ticket_index_name(ticket["tenant_id"])).add_documents(
            [ticket], primary_key="id"
        )
    except Exception as exc:
        logger.warning("티켓 인덱싱 실패 (id=%s): %s", ticket.get("id"), exc)


async def delete_ticket(tenant_id: str, ticket_id: str) -> None:
    """티켓 인덱스 삭제."""
    client = _get_client()
    if client is None:
        return
    try:
        client.index(_ticket_index_name(tenant_id)).delete_document(ticket_id)
    except Exception as exc:
        logger.warning("티켓 인덱스 삭제 실패 (id=%s): %s", ticket_id, exc)


async def search_tickets(tenant_id: str, q: str, limit: int = 20) -> list[dict]:
    """티켓 전문 검색. 실패 시 빈 목록 반환."""
    client = _get_client()
    if client is None:
        return []
    try:
        result = client.index(_ticket_index_name(tenant_id)).search(
            q, {"limit": limit, "showRankingScore": True}
        )
        hits = result.get("hits", [])
        return [
            {
                "id": h.get("id", ""),
                "title": h.get("title", ""),
                "status": h.get("status", ""),
                "score": h.get("_rankingScore", 0.0),
            }
            for h in hits
        ]
    except Exception as exc:
        logger.warning("티켓 검색 실패 (tenant=%s, q=%s): %s", tenant_id, q, exc)
        return []


# ------------------------------------------------------------------
# KB 인덱싱
# ------------------------------------------------------------------


async def index_kb(doc: KbDoc) -> None:
    """KB 문서 upsert 인덱싱."""
    client = _get_client()
    if client is None:
        return
    try:
        # primary_key 명시 필수 (index_ticket 동일 사유 — 'id'·'tenant_id' 다중 후보).
        client.index(_kb_index_name(doc["tenant_id"])).add_documents(
            [doc], primary_key="id"
        )
    except Exception as exc:
        logger.warning("KB 인덱싱 실패 (id=%s): %s", doc.get("id"), exc)


async def delete_kb(tenant_id: str, kb_id: str) -> None:
    """KB 인덱스 삭제."""
    client = _get_client()
    if client is None:
        return
    try:
        client.index(_kb_index_name(tenant_id)).delete_document(kb_id)
    except Exception as exc:
        logger.warning("KB 인덱스 삭제 실패 (id=%s): %s", kb_id, exc)


async def search_kb(tenant_id: str, q: str, limit: int = 20) -> list[dict]:
    """KB 전문 검색. 실패 시 빈 목록 반환."""
    client = _get_client()
    if client is None:
        return []
    try:
        result = client.index(_kb_index_name(tenant_id)).search(
            q, {"limit": limit, "showRankingScore": True}
        )
        hits = result.get("hits", [])
        return [
            {
                "id": h.get("id", ""),
                "title": h.get("title", ""),
                "score": h.get("_rankingScore", 0.0),
            }
            for h in hits
        ]
    except Exception as exc:
        logger.warning("KB 검색 실패 (tenant=%s, q=%s): %s", tenant_id, q, exc)
        return []
