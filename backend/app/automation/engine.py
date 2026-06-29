"""자동화 룰 엔진 — dispatch 진입점.

dispatch(trigger_event, payload, db, depth=0):
  1. 해당 tenant+trigger+enabled 룰 조회 (priority DESC)
  2. idempotency_key 중복 확인 → 중복 skip
  3. depth >= MAX_DEPTH → skipped
  4. run_limit_per_hour 초과 → rate_limited
  5. 조건 평가 (JSONLogic)
  6. 조건 미매칭 → matched=False, status=skipped 기록
  7. 조건 매칭 → 액션 순서대로 실행 (부분실패 격리)
  8. automation_rule_runs 기록

설계 원칙:
- dispatch()는 항상 try-catch graceful: 엔진 실패가 티켓 작업 깨면 안 됨
- 각 액션은 독립 try-except: 한 액션 실패가 다른 액션 막지 않음
- DB flush는 caller commit에 위임 (트랜잭션 분리 시 별도 세션 사용)
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.automation.evaluator import EvaluationError, evaluate_conditions
from app.automation.models import AutomationRule, AutomationRuleRun
from app.automation.actions import ActionError, execute_action

logger = logging.getLogger(__name__)

MAX_DEPTH = 3
_REDIS_RATE_LIMIT_TTL = 3600  # 1시간 슬라이딩


def _make_idempotency_key(trigger_event: str, entity_id: str, rule_id: str) -> str:
    """멱등성 키: hash(trigger_event:entity_id:rule_id) — 1분 이내 중복 실행 차단."""
    raw = f"{trigger_event}:{entity_id}:{rule_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


async def _check_rate_limit(rule: AutomationRule) -> bool:
    """run_limit_per_hour 초과 여부. True = 허용, False = 제한 초과."""
    if rule.run_limit_per_hour is None:
        return True  # 무제한
    try:
        from app.core.redis import get_redis

        redis = get_redis()
        key = f"itsm:auto_rate:{rule.id}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _REDIS_RATE_LIMIT_TTL)
        return count <= rule.run_limit_per_hour
    except Exception as exc:
        logger.warning("rate limit Redis 오류 (무제한 처리): %s", exc)
        return True  # Redis 실패 시 허용 (graceful)


async def _record_run(
    db: AsyncSession,
    *,
    rule: AutomationRule,
    trigger_event: str,
    trigger_payload: dict[str, Any],
    matched: bool,
    depth: int,
    idempotency_key: str | None,
    actions_result: list[dict[str, Any]] | None,
    status: str,
    error: str | None,
) -> AutomationRuleRun | None:
    """automation_rule_runs에 실행 기록.

    SAVEPOINT로 감싸 IntegrityError(중복 멱등키) 발생 시 외부 트랜잭션(ticket update)
    오염 없이 격리 롤백 → None 반환.
    """
    run = AutomationRuleRun(
        id=uuid.uuid4(),
        rule_id=rule.id,
        tenant_id=rule.tenant_id,
        trigger_event=trigger_event,
        trigger_payload=trigger_payload,
        matched=matched,
        depth=depth,
        idempotency_key=idempotency_key,
        actions_result=actions_result,
        status=status,
        error=error,
        created_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc) if status in ("done", "failed", "skipped", "rate_limited") else None,
    )
    try:
        async with db.begin_nested() as savepoint:
            db.add(run)
            await db.flush()
        return run
    except IntegrityError:
        logger.info(
            "automation run 중복 skip (idempotency): rule=%s key=%s",
            rule.id,
            idempotency_key,
        )
        return None
    except Exception as exc:
        logger.warning("automation _record_run 실패: %s", exc)
        return None


async def dispatch(
    trigger_event: str,
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> None:
    """트리거 이벤트 발화 → 매칭 룰 조회 → 조건 평가 → 액션 실행.

    항상 graceful: 예외는 로깅 후 삼킴 — 티켓 작업 절대 방해 금지.
    ITSM 패턴: 동일 db 세션 사용. 내부에서 commit 없음 — caller가 commit.
    caller(tickets.py)는 dispatch() 반환 후 `await db.commit()` 필수.

    Args:
        trigger_event: 예) "ticket.status_changed"
        payload: 트리거 페이로드 딕셔너리 (tenant_id 포함)
        db: 현재 request DB 세션 (caller 트랜잭션 공유)
        depth: 재귀 깊이 (0-indexed, 최대 MAX_DEPTH-1까지 실행)
    """
    tenant_id_raw = payload.get("tenant_id")
    if not tenant_id_raw:
        logger.warning("automation dispatch: payload에 tenant_id 없음 (event=%s)", trigger_event)
        return

    try:
        tenant_id = uuid.UUID(str(tenant_id_raw))
    except (ValueError, AttributeError):
        logger.warning("automation dispatch: tenant_id 파싱 실패: %s", tenant_id_raw)
        return

    # entity_id: 멱등성 키용 — ticket_id 우선, 없으면 임의
    entity_id = str(payload.get("ticket_id", uuid.uuid4()))

    try:
        rules = (
            await db.execute(
                select(AutomationRule)
                .where(
                    and_(
                        AutomationRule.tenant_id == tenant_id,
                        AutomationRule.trigger_event == trigger_event,
                        AutomationRule.enabled.is_(True),
                    )
                )
                .order_by(AutomationRule.priority.desc())
            )
        ).scalars().all()
    except Exception as exc:
        logger.error("automation dispatch: 룰 조회 실패 (무시): %s", exc)
        return

    if not rules:
        return

    for rule in rules:
        await _execute_rule(
            rule=rule,
            trigger_event=trigger_event,
            payload=payload,
            entity_id=entity_id,
            db=db,
            depth=depth,
        )
    # Note: commit은 caller(tickets.py)에서 수행


async def _dispatch_task(
    trigger_event: str,
    payload: dict[str, Any],
    entity_id: str,
    depth: int,
    tenant_id: uuid.UUID | None = None,
) -> None:
    """독립 DB 세션으로 실행되는 디스패치 로직.

    별도 DB 세션을 열어 룰 조회 + 실행 + 커밋을 완전히 격리한다.
    주 요청 세션의 expire/greenlet 오염 없음.
    """
    try:
        from app.core.database import AsyncSessionLocal

        if tenant_id is None:
            tenant_id = uuid.UUID(str(payload["tenant_id"]))
        async with AsyncSessionLocal() as session:
            try:
                rules = (
                    await session.execute(
                        select(AutomationRule)
                        .where(
                            and_(
                                AutomationRule.tenant_id == tenant_id,
                                AutomationRule.trigger_event == trigger_event,
                                AutomationRule.enabled.is_(True),
                            )
                        )
                        .order_by(AutomationRule.priority.desc())
                    )
                ).scalars().all()
            except Exception as exc:
                logger.error("automation _dispatch_task: 룰 조회 실패: %s", exc)
                return

            if not rules:
                return

            for rule in rules:
                await _execute_rule(
                    rule=rule,
                    trigger_event=trigger_event,
                    payload=payload,
                    entity_id=entity_id,
                    db=session,
                    depth=depth,
                )

            try:
                await session.commit()
            except Exception as exc:
                logger.warning("automation _dispatch_task commit 실패: %s", exc)
                await session.rollback()
    except Exception as exc:
        import traceback
        logger.error("automation _dispatch_task 예상치 못한 오류: %s\n%s", exc, traceback.format_exc())


async def _execute_rule(
    rule: AutomationRule,
    trigger_event: str,
    payload: dict[str, Any],
    entity_id: str,
    db: AsyncSession,
    depth: int,
) -> None:
    """단일 룰 실행. 모든 예외 graceful."""
    try:
        # 1. 깊이 체크
        if depth >= MAX_DEPTH:
            await _record_run(
                db,
                rule=rule,
                trigger_event=trigger_event,
                trigger_payload=payload,
                matched=False,
                depth=depth,
                idempotency_key=None,
                actions_result=None,
                status="skipped",
                error="max_depth_exceeded",
            )
            logger.info("automation rule=%s skipped: max_depth_exceeded (depth=%d)", rule.id, depth)
            return

        # 2. 멱등성 키
        idempotency_key = _make_idempotency_key(trigger_event, entity_id, str(rule.id))

        # 3. run_limit_per_hour 체크
        if not await _check_rate_limit(rule):
            await _record_run(
                db,
                rule=rule,
                trigger_event=trigger_event,
                trigger_payload=payload,
                matched=False,
                depth=depth,
                idempotency_key=None,  # rate_limited는 idempotency 없음
                actions_result=None,
                status="rate_limited",
                error=f"run_limit_per_hour({rule.run_limit_per_hour}) 초과",
            )
            logger.info("automation rule=%s rate_limited", rule.id)
            return

        # 4. 조건 평가
        try:
            conditions: list[Any] = rule.conditions if rule.conditions else []
            matched = evaluate_conditions(conditions, payload)
        except EvaluationError as exc:
            await _record_run(
                db,
                rule=rule,
                trigger_event=trigger_event,
                trigger_payload=payload,
                matched=False,
                depth=depth,
                idempotency_key=idempotency_key,
                actions_result=None,
                status="failed",
                error=f"조건 평가 오류: {exc}",
            )
            return

        if not matched:
            await _record_run(
                db,
                rule=rule,
                trigger_event=trigger_event,
                trigger_payload=payload,
                matched=False,
                depth=depth,
                idempotency_key=idempotency_key,
                actions_result=None,
                status="skipped",
                error=None,
            )
            return

        # 5. 액션 실행 (부분실패 격리)
        actions: list[dict[str, Any]] = rule.actions if rule.actions else []
        actions_result: list[dict[str, Any]] = []
        overall_status = "done"

        for action in actions:
            action_type = action.get("type", "")
            action_params = action.get("params", {})
            try:
                result = await execute_action(action_type, action_params, payload, db)
                actions_result.append({"type": action_type, **result})
            except ActionError as exc:
                logger.warning("automation action %s 실패 (격리): %s", action_type, exc)
                actions_result.append({"type": action_type, "status": "error", "error": str(exc)})
                overall_status = "failed"
            except Exception as exc:
                logger.error("automation action %s 예상치 못한 실패: %s", action_type, exc)
                actions_result.append({"type": action_type, "status": "error", "error": str(exc)})
                overall_status = "failed"

        # 6. 실행 기록 (멱등성 키 포함)
        run = await _record_run(
            db,
            rule=rule,
            trigger_event=trigger_event,
            trigger_payload=payload,
            matched=True,
            depth=depth,
            idempotency_key=idempotency_key,
            actions_result=actions_result,
            status=overall_status,
            error=None,
        )
        if run is None:
            # 중복 실행 → 이미 처리됨
            logger.debug("automation rule=%s 이미 처리됨 (idempotency key 중복)", rule.id)

    except Exception as exc:
        logger.error("automation _execute_rule 예상치 못한 오류 (무시): rule=%s %s", rule.id, exc)
