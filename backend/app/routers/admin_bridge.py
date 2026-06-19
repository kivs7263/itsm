"""Admin Portal ↔ ITSM bridge 라우터 — ADR-044.

Admin Portal service account JWT(azp=admin-portal, role=admin-portal-bridge)만 호출 가능.
ITSM 테넌트·멤버 프로비저닝/관리를 제공한다.

인증:
    verify_admin_portal_jwt — KC JWKS RS256 + azp/role 이중 확인.

역할 매핑 (SSO Portal admin/member → ITSM UserRole):
    admin  → UserRole.admin
    member → UserRole.engineer  (기본)

엔드포인트:
    GET    /api/admin/health
    POST   /api/admin/tenants
    DELETE /api/admin/tenants/by-org/{kc_org_id}
    POST   /api/admin/tenants/{slug}/members
    DELETE /api/admin/tenants/{slug}/members/{kc_user_id}
    POST   /api/admin/tenants/{slug}/members/{kc_user_id}/restore
    PUT    /api/admin/tenants/{slug}/members/{kc_user_id}/role
    GET    /api/admin/tenants/{slug}/members
"""
import logging
import secrets
import uuid as _uuid
from datetime import UTC, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import verify_admin_portal_jwt
from app.models.tenant import Tenant
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-bridge"])

# ── 역할 매핑 테이블 (SSO Portal → ITSM) ────────────────────────────────────
# SSO Portal은 단순 admin/member 구분. ITSM은 세분화된 역할 보유.
# admin → admin (조직 관리자)
# member → engineer (기본 처리 담당자)
# 역할 변경 API로 이후 세분화 가능 (team_lead / sales / c_level 등).
_ROLE_MAP: dict[str, UserRole] = {
    "admin": UserRole.admin,
    "member": UserRole.engineer,
}

# 역방향: ITSM UserRole → SSO Portal 계약(admin | member).
# product-client.ts MemberData.role 타입이 'admin' | 'member'이므로 그 외 값 반환 금지.
def _role_to_sso(role) -> str:
    role_value = role.value if hasattr(role, "value") else str(role)
    return "admin" if role_value == UserRole.admin.value else "member"


# ── 스키마 ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    db: str
    kc_jwks: str


class CreateTenantRequest(BaseModel):
    slug: str
    name: str
    orgId: str  # KC org UUID (ADR-002)


class TenantResponse(BaseModel):
    id: str
    slug: str
    name: str
    member_count: int

    class Config:
        from_attributes = True


class AddMemberRequest(BaseModel):
    kc_user_id: str
    email: str
    full_name: str
    role: str  # "admin" | "member"


class MemberResponse(BaseModel):
    kc_user_id: Optional[str]
    email: str
    full_name: str
    role: str
    is_active: bool
    joined_at: Optional[datetime]

    class Config:
        from_attributes = True


class MemberListResponse(BaseModel):
    members: list[MemberResponse]
    total: int


class ChangeRoleRequest(BaseModel):
    role: str  # "admin" | "member"


# ── 공통 헬퍼 ────────────────────────────────────────────────────────────────

async def _get_tenant_by_slug(slug: str, db: AsyncSession) -> Tenant:
    """slug로 활성 테넌트 조회. 없으면 404."""
    result = await db.execute(
        select(Tenant).where(Tenant.slug == slug)
    )
    tenant = result.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "status": "error",
                "code": "TENANT_NOT_FOUND",
                "message": f"테넌트를 찾을 수 없습니다: {slug}",
            },
        )
    return tenant


async def _get_member(tenant_id, kc_user_id: str, db: AsyncSession) -> User:
    """테넌트 소속 + kc_user_id로 User 조회. 없으면 404."""
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.kc_user_id == kc_user_id,
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "status": "error",
                "code": "MEMBER_NOT_FOUND",
                "message": "해당 멤버를 찾을 수 없습니다.",
            },
        )
    return user


def _user_to_response(user: User) -> MemberResponse:
    return MemberResponse(
        kc_user_id=user.kc_user_id,
        email=user.email,
        full_name=user.name,
        role=_role_to_sso(user.role),
        is_active=user.is_active,
        joined_at=user.created_at,
    )


def _sso_dummy_password() -> str:
    """SSO 생성 사용자용 더미 비밀번호 (KC가 인증 담당, 직접 로그인 불가)."""
    return "provider_sso_" + secrets.token_hex(16)


# ── 헬스체크 ─────────────────────────────────────────────────────────────────

@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Admin bridge 헬스체크",
)
async def admin_bridge_health(
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> HealthResponse:
    """Admin Portal JWT 검증 + DB + KC JWKS 상태 반환."""
    db_status = "ok"
    try:
        from sqlalchemy import text
        await db.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    kc_jwks_status = "ok"
    try:
        from app.core.config import settings
        from app.core.dependencies import _fetch_jwks
        if settings.KEYCLOAK_INTERNAL_URL:
            await _fetch_jwks(settings.KEYCLOAK_INTERNAL_URL)
        else:
            kc_jwks_status = "unconfigured"
    except Exception:
        kc_jwks_status = "error"

    overall = "ok" if db_status == "ok" else "degraded"
    return HealthResponse(status=overall, db=db_status, kc_jwks=kc_jwks_status)


# ── 테넌트 생성 ──────────────────────────────────────────────────────────────

@router.post(
    "/tenants",
    response_model=TenantResponse,
    status_code=status.HTTP_201_CREATED,
    summary="테넌트 생성 (org_create saga 전용)",
)
async def create_tenant(
    body: CreateTenantRequest,
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> TenantResponse:
    """KC org 생성 직후 ITSM 테넌트를 프로비저닝한다.

    멱등 보장: 동일 slug 존재 시 기존 테넌트 반환.
    """
    existing = (await db.execute(
        select(Tenant).where(Tenant.slug == body.slug)
    )).scalar_one_or_none()

    if existing is not None:
        count = (await db.execute(
            select(func.count()).select_from(User).where(
                User.tenant_id == existing.id,
                User.is_active.is_(True),
            )
        )).scalar_one()
        return TenantResponse(
            id=str(existing.id),
            slug=existing.slug,
            name=existing.name,
            member_count=count,
        )

    tenant = Tenant(
        slug=body.slug,
        name=body.name,
        sso_org_id=_uuid.UUID(body.orgId),
    )
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    logger.info("admin_bridge: ITSM 테넌트 생성 slug=%s org_id=%s", body.slug, body.orgId)
    return TenantResponse(id=str(tenant.id), slug=tenant.slug, name=tenant.name, member_count=0)


# ── 테넌트 saga 보상 ─────────────────────────────────────────────────────────

@router.delete(
    "/tenants/by-org/{kc_org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="테넌트 saga 보상 — sso_org_id 기반 soft-delete",
)
async def delete_tenant_by_org(
    kc_org_id: str,
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """org_create saga 보상: 이미 생성된 ITSM 테넌트를 제거한다.

    테넌트가 없으면 멱등 처리(204 반환).
    ITSM Tenant 모델에 is_active 필드가 없으므로 물리 삭제.
    단, 멱등성 보장을 위해 존재하지 않으면 204.
    """
    try:
        org_uuid = _uuid.UUID(kc_org_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"status": "error", "code": "INVALID_ORG_ID", "message": "유효하지 않은 org_id 형식입니다."},
        )

    result = await db.execute(
        select(Tenant).where(Tenant.sso_org_id == org_uuid)
    )
    tenant = result.scalar_one_or_none()
    if tenant is not None:
        await db.delete(tenant)
        await db.commit()
        logger.info("admin_bridge: saga 보상 — ITSM 테넌트 삭제 kc_org_id=%s slug=%s", kc_org_id, tenant.slug)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 멤버 목록 ────────────────────────────────────────────────────────────────

@router.get(
    "/tenants/{slug}/members",
    response_model=MemberListResponse,
    summary="테넌트 멤버 목록 조회",
)
async def list_members(
    slug: str,
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> MemberListResponse:
    """테넌트 멤버 목록 (is_active 기준 필터 없음 — 전체 반환, SSO Portal 관리 UI용).

    멀티테넌트 격리: slug → tenant 해석 후 tenant_id 스코프 적용 필수.
    """
    tenant = await _get_tenant_by_slug(slug, db)

    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant.id,
        ).order_by(User.created_at)
    )
    users = result.scalars().all()
    members = [_user_to_response(u) for u in users]
    return MemberListResponse(members=members, total=len(members))


# ── 멤버 추가 ────────────────────────────────────────────────────────────────

@router.post(
    "/tenants/{slug}/members",
    response_model=MemberResponse,
    status_code=status.HTTP_201_CREATED,
    summary="테넌트 멤버 추가 (KC 사용자 upsert)",
)
async def add_member(
    slug: str,
    body: AddMemberRequest,
    request: Request,
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> MemberResponse:
    """KC 사용자를 ITSM 테넌트 멤버로 추가한다.

    멱등성:
    - Idempotency-Key 헤더 있으면 기존 멤버도 200/201 안정 응답.
    - kc_user_id로 기존 멤버 탐색 → 있으면 upsert(이름·이메일·역할 갱신).
    - 없으면 신규 생성.

    멀티테넌트 격리: tenant_id 스코프 적용.
    """
    tenant = await _get_tenant_by_slug(slug, db)
    idempotency_key = request.headers.get("Idempotency-Key")

    # kc_user_id 기반 기존 멤버 조회 (upsert)
    existing = (await db.execute(
        select(User).where(
            User.tenant_id == tenant.id,
            User.kc_user_id == body.kc_user_id,
        )
    )).scalar_one_or_none()

    if existing is not None:
        # upsert: 기존 멤버 정보 갱신
        existing.email = body.email
        existing.name = body.full_name
        existing.role = _ROLE_MAP.get(body.role, UserRole.engineer)
        existing.is_active = True
        await db.commit()
        await db.refresh(existing)
        logger.info(
            "admin_bridge: 멤버 upsert(갱신) tenant=%s kc_user_id=%s",
            slug, body.kc_user_id,
        )
        return _user_to_response(existing)

    # email 중복 체크 (kc_user_id 없는 기존 이메일 계정과 충돌 방지)
    email_existing = (await db.execute(
        select(User).where(
            User.tenant_id == tenant.id,
            User.email == body.email,
            User.kc_user_id.is_(None),
        )
    )).scalar_one_or_none()

    if email_existing is not None:
        # 기존 이메일 계정에 kc_user_id 연결 (email 기반 → KC 계정 연결)
        email_existing.kc_user_id = body.kc_user_id
        email_existing.name = body.full_name
        email_existing.role = _ROLE_MAP.get(body.role, UserRole.engineer)
        email_existing.is_active = True
        await db.commit()
        await db.refresh(email_existing)
        logger.info(
            "admin_bridge: 기존 email 계정에 kc_user_id 연결 tenant=%s email=%s",
            slug, body.email,
        )
        return _user_to_response(email_existing)

    # 신규 사용자 생성
    user_role = _ROLE_MAP.get(body.role, UserRole.engineer)
    new_user = User(
        tenant_id=tenant.id,
        email=body.email,
        name=body.full_name,
        role=user_role,
        hashed_password=_sso_dummy_password(),
        is_active=True,
        kc_user_id=body.kc_user_id,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    logger.info(
        "admin_bridge: 멤버 추가 tenant=%s email=%s role=%s kc_user_id=%s",
        slug, body.email, body.role, body.kc_user_id,
    )
    return _user_to_response(new_user)


# ── 멤버 비활성화 (soft delete) ──────────────────────────────────────────────

@router.delete(
    "/tenants/{slug}/members/{kc_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="테넌트 멤버 비활성화 (soft delete)",
)
async def deactivate_member(
    slug: str,
    kc_user_id: str,
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """멤버를 소프트 삭제(is_active=False)로 비활성화한다.

    멀티테넌트 격리: slug → tenant_id 스코프 확인 필수.
    멱등성: 이미 비활성화 상태면 204 no-op (saga retry/보상 시 PARTIAL 방지).
    """
    tenant = await _get_tenant_by_slug(slug, db)
    user = await _get_member(tenant.id, kc_user_id, db)

    if not user.is_active:
        # 멱등 no-op — 이미 원하는 상태이므로 성공 처리.
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    user.is_active = False
    await db.commit()
    logger.info("admin_bridge: 멤버 비활성화 tenant=%s kc_user_id=%s", slug, kc_user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 멤버 복구 ────────────────────────────────────────────────────────────────

@router.post(
    "/tenants/{slug}/members/{kc_user_id}/restore",
    response_model=MemberResponse,
    summary="테넌트 멤버 복구",
)
async def restore_member(
    slug: str,
    kc_user_id: str,
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> MemberResponse:
    """비활성화된 멤버를 복구(is_active=True)한다."""
    tenant = await _get_tenant_by_slug(slug, db)
    user = await _get_member(tenant.id, kc_user_id, db)

    if user.is_active:
        # 멱등 no-op — 이미 활성 상태이므로 현재 멤버 그대로 반환.
        return _user_to_response(user)

    user.is_active = True
    await db.commit()
    await db.refresh(user)
    logger.info("admin_bridge: 멤버 복구 tenant=%s kc_user_id=%s", slug, kc_user_id)
    return _user_to_response(user)


# ── 역할 변경 ────────────────────────────────────────────────────────────────

@router.put(
    "/tenants/{slug}/members/{kc_user_id}/role",
    response_model=MemberResponse,
    summary="테넌트 멤버 역할 변경",
)
async def change_member_role(
    slug: str,
    kc_user_id: str,
    body: ChangeRoleRequest,
    _: dict = Depends(verify_admin_portal_jwt),
    db: AsyncSession = Depends(get_db),
) -> MemberResponse:
    """멤버 역할을 변경한다. SSO Portal의 admin/member를 ITSM UserRole로 매핑."""
    tenant = await _get_tenant_by_slug(slug, db)
    user = await _get_member(tenant.id, kc_user_id, db)

    user.role = _ROLE_MAP.get(body.role, UserRole.engineer)
    await db.commit()
    await db.refresh(user)
    logger.info(
        "admin_bridge: 역할 변경 tenant=%s kc_user_id=%s role=%s",
        slug, kc_user_id, body.role,
    )
    return _user_to_response(user)
