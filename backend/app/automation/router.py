"""자동화 룰 엔진 관리자 API.

prefix : /{tenant_slug}/automation
인증   : get_current_user + require_roles(admin, team_lead)
격리   : tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/automation/rules             — 룰 목록
  POST   /{tenant_slug}/automation/rules             — 룰 생성
  GET    /{tenant_slug}/automation/rules/{id}        — 룰 상세
  PATCH  /{tenant_slug}/automation/rules/{id}        — 룰 수정
  DELETE /{tenant_slug}/automation/rules/{id}        — 룰 삭제
  PATCH  /{tenant_slug}/automation/rules/{id}/toggle — 활성/비활성 전환
  GET    /{tenant_slug}/automation/runs              — 실행 이력
  GET    /{tenant_slug}/automation/runs/{id}         — 실행 이력 상세
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.user import User, UserRole
from app.automation.models import AutomationRule, AutomationRuleRun
from app.automation.evaluator import EvaluationError, validate_conditions
from app.automation.actions import get_registered_actions

router = APIRouter(
    prefix="/{tenant_slug}/automation",
    tags=["automation"],
)


# ---------------------------------------------------------------------------
# 스키마
# ---------------------------------------------------------------------------

SUPPORTED_TRIGGERS = {
    "ticket.status_changed",
    "ticket.sla_breach_warning",
    "ticket.created",
    "ticket.assigned",   # Phase 1c: 담당자 배정 시 발화 (tickets.py PATCH 훅 배선 완료)
}


class RuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    trigger_event: str
    conditions: list[Any] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)
    priority: int = Field(default=0, ge=0, le=10000)
    run_limit_per_hour: int | None = Field(default=100, ge=1)
    enabled: bool = True


class RuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    trigger_event: str | None = None
    conditions: list[Any] | None = None
    actions: list[dict[str, Any]] | None = None
    priority: int | None = Field(default=None, ge=0, le=10000)
    run_limit_per_hour: int | None = Field(default=None, ge=1)
    enabled: bool | None = None


class RuleOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None
    enabled: bool
    trigger_event: str
    conditions: list[Any]
    actions: list[dict[str, Any]]
    priority: int
    run_limit_per_hour: int | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RunOut(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID
    tenant_id: uuid.UUID
    trigger_event: str
    trigger_payload: dict[str, Any]
    matched: bool
    depth: int
    idempotency_key: str | None
    actions_result: list[Any] | None
    status: str
    error: str | None
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class ToggleOut(BaseModel):
    id: uuid.UUID
    enabled: bool


# ---------------------------------------------------------------------------
# 공통 헬퍼
# ---------------------------------------------------------------------------


def _validate_rule_payload(trigger_event: str, conditions: list[Any], actions: list[dict[str, Any]]) -> None:
    """트리거/조건/액션 유효성 검사."""
    if trigger_event not in SUPPORTED_TRIGGERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"지원하지 않는 trigger_event: {trigger_event!r}. 지원: {sorted(SUPPORTED_TRIGGERS)}",
        )
    try:
        validate_conditions(conditions)
    except EvaluationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"조건 오류: {exc}",
        )
    allowed = get_registered_actions()
    for action in actions:
        atype = action.get("type")
        if not atype or atype not in allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"지원하지 않는 action type: {atype!r}. 허용: {allowed}",
            )


async def _get_rule_or_404(
    rule_id: uuid.UUID,
    tenant_id: uuid.UUID,
    db: AsyncSession,
) -> AutomationRule:
    rule = await db.scalar(
        select(AutomationRule).where(
            and_(
                AutomationRule.id == rule_id,
                AutomationRule.tenant_id == tenant_id,
            )
        )
    )
    if not rule:
        raise HTTPException(status_code=404, detail="룰을 찾을 수 없습니다.")
    return rule


# ---------------------------------------------------------------------------
# 룰 CRUD
# ---------------------------------------------------------------------------


@router.get(
    "/rules",
    response_model=list[RuleOut],
    summary="자동화 룰 목록",
)
async def list_rules(
    tenant_slug: str,
    enabled: bool | None = Query(default=None),
    trigger_event: str | None = Query(default=None),
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> list[RuleOut]:
    q = select(AutomationRule).where(AutomationRule.tenant_id == current_user.tenant_id)
    if enabled is not None:
        q = q.where(AutomationRule.enabled.is_(enabled))
    if trigger_event:
        q = q.where(AutomationRule.trigger_event == trigger_event)
    q = q.order_by(desc(AutomationRule.priority), AutomationRule.created_at)
    rows = (await db.execute(q)).scalars().all()
    return [RuleOut.model_validate(r) for r in rows]


@router.post(
    "/rules",
    response_model=RuleOut,
    status_code=status.HTTP_201_CREATED,
    summary="자동화 룰 생성",
)
async def create_rule(
    tenant_slug: str,
    data: RuleCreate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> RuleOut:
    _validate_rule_payload(data.trigger_event, data.conditions, data.actions)

    rule = AutomationRule(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        description=data.description,
        enabled=data.enabled,
        trigger_event=data.trigger_event,
        conditions=data.conditions,
        actions=data.actions,
        priority=data.priority,
        run_limit_per_hour=data.run_limit_per_hour,
        created_by=current_user.id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(rule)
    try:
        await db.commit()
        await db.refresh(rule)
    except Exception as exc:
        await db.rollback()
        if "uq_automation_rules_tenant_name" in str(exc):
            raise HTTPException(status_code=409, detail=f"같은 이름의 룰이 이미 존재합니다: {data.name}")
        raise HTTPException(status_code=500, detail="룰 생성 실패")
    return RuleOut.model_validate(rule)


@router.get(
    "/rules/{rule_id}",
    response_model=RuleOut,
    summary="자동화 룰 상세",
)
async def get_rule(
    tenant_slug: str,
    rule_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> RuleOut:
    rule = await _get_rule_or_404(rule_id, current_user.tenant_id, db)
    return RuleOut.model_validate(rule)


@router.patch(
    "/rules/{rule_id}",
    response_model=RuleOut,
    summary="자동화 룰 수정",
)
async def update_rule(
    tenant_slug: str,
    rule_id: uuid.UUID,
    data: RuleUpdate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> RuleOut:
    rule = await _get_rule_or_404(rule_id, current_user.tenant_id, db)

    update_fields = data.model_dump(exclude_unset=True)

    # 수정 내용 기반 재검증
    new_trigger = update_fields.get("trigger_event", rule.trigger_event)
    new_conditions = update_fields.get("conditions", rule.conditions)
    new_actions = update_fields.get("actions", rule.actions)
    _validate_rule_payload(new_trigger, new_conditions, new_actions)

    for field, value in update_fields.items():
        setattr(rule, field, value)
    rule.updated_at = datetime.now(timezone.utc)

    try:
        await db.commit()
        await db.refresh(rule)
    except Exception as exc:
        await db.rollback()
        if "uq_automation_rules_tenant_name" in str(exc):
            raise HTTPException(status_code=409, detail=f"같은 이름의 룰이 이미 존재합니다")
        raise HTTPException(status_code=500, detail="룰 수정 실패")
    return RuleOut.model_validate(rule)


@router.delete(
    "/rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="자동화 룰 삭제",
)
async def delete_rule(
    tenant_slug: str,
    rule_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    rule = await _get_rule_or_404(rule_id, current_user.tenant_id, db)
    await db.delete(rule)
    await db.commit()


@router.patch(
    "/rules/{rule_id}/toggle",
    response_model=ToggleOut,
    summary="룰 활성/비활성 전환",
)
async def toggle_rule(
    tenant_slug: str,
    rule_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> ToggleOut:
    rule = await _get_rule_or_404(rule_id, current_user.tenant_id, db)
    rule.enabled = not rule.enabled
    rule.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rule)
    return ToggleOut(id=rule.id, enabled=rule.enabled)


# ---------------------------------------------------------------------------
# 실행 이력
# ---------------------------------------------------------------------------


@router.get(
    "/runs",
    response_model=list[RunOut],
    summary="자동화 실행 이력",
)
async def list_runs(
    tenant_slug: str,
    rule_id: uuid.UUID | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> list[RunOut]:
    q = select(AutomationRuleRun).where(AutomationRuleRun.tenant_id == current_user.tenant_id)
    if rule_id:
        q = q.where(AutomationRuleRun.rule_id == rule_id)
    if status_filter:
        q = q.where(AutomationRuleRun.status == status_filter)
    q = q.order_by(desc(AutomationRuleRun.created_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [RunOut.model_validate(r) for r in rows]


@router.get(
    "/runs/{run_id}",
    response_model=RunOut,
    summary="자동화 실행 이력 상세",
)
async def get_run(
    tenant_slug: str,
    run_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    run = await db.scalar(
        select(AutomationRuleRun).where(
            and_(
                AutomationRuleRun.id == run_id,
                AutomationRuleRun.tenant_id == current_user.tenant_id,
            )
        )
    )
    if not run:
        raise HTTPException(status_code=404, detail="실행 이력을 찾을 수 없습니다.")
    return RunOut.model_validate(run)
