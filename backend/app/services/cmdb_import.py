"""CMDB Discovery Import 서비스 — CSV / JSON API 대량 import (CA-P2-5).

CI dedup 키 우선순위:
  1. (tenant_id, hostname)
  2. (tenant_id, ip_address)  — hostname 없는 경우
  3. (tenant_id, name)        — 위 둘 다 없는 경우

Asset dedup 키: (tenant_id, asset_tag)

savepoint 격리: 행 단위 오류가 전체 트랜잭션을 깨지 않도록
  async with db.begin_nested() 사용. 오류 행만 롤백.

import_run 기록: upsert 커밋 이후 별도 커밋 (expire/rollback 오염 방지).
"""
from __future__ import annotations

import csv
import io
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset, AssetType
from app.models.cmdb import (
    CIChangeLog,
    CICriticality,
    CIEnvironment,
    CIStatus,
    CIType,
    ConfigurationItem,
)
from app.models.user import User

logger = logging.getLogger(__name__)


# CI 변경이력 추적 대상 필드 (cmdb.py _TRACKED_FIELDS 서브셋)
_CI_TRACKED = [
    "ci_type",
    "name",
    "hostname",
    "ip_address",
    "os_type",
    "os_version",
    "environment",
    "status",
    "criticality",
]

# ── 유효 enum 값 집합 (O(1) 검증용) ────────────────────────────────
_VALID_CI_TYPE = {e.value for e in CIType}
_VALID_CI_ENV = {e.value for e in CIEnvironment}
_VALID_CI_STATUS = {e.value for e in CIStatus}
_VALID_CI_CRITICALITY = {e.value for e in CICriticality}
_VALID_ASSET_TYPE = {e.value for e in AssetType}


def _val_to_str(val: Any) -> str | None:
    """변경이력 비교용 문자열 변환 (dict → JSON 직렬화)."""
    if val is None:
        return None
    if isinstance(val, dict):
        return json.dumps(val, sort_keys=True, ensure_ascii=False)
    return str(val)


@dataclass
class ImportResult:
    total_rows: int = 0
    created_count: int = 0
    updated_count: int = 0
    skipped_count: int = 0
    error_count: int = 0
    errors: list[dict] = field(default_factory=list)
    dedup_key: str | None = None

    @property
    def status(self) -> str:
        if self.error_count == 0 and self.skipped_count == 0:
            return "completed"
        if self.created_count > 0 or self.updated_count > 0:
            return "partial"
        return "failed"


# ── CSV 파싱 ────────────────────────────────────────────────────────


def parse_csv(content: str, target: str) -> list[dict]:
    """CSV 텍스트 → 행 dict 리스트.

    - 헤더 기반 매핑. 알 수 없는 컬럼 무시.
    - 빈 행 skip (모든 셀이 공백인 경우).
    - 셀 값은 strip 처리 후, 빈 문자열 → None.
    """
    reader = csv.DictReader(io.StringIO(content))
    rows: list[dict] = []
    for row in reader:
        if not any(v.strip() for v in row.values()):
            continue
        normalized = {k.strip(): (v.strip() or None) for k, v in row.items()}
        rows.append(normalized)
    return rows


# ── CI upsert ───────────────────────────────────────────────────────


async def upsert_cis(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    rows: list[dict],
    user: User,
) -> ImportResult:
    """CI 행 일괄 upsert.

    각 행을 savepoint로 격리: 실패 행 rollback → 다음 행 계속.
    dedup_key: 실제로 사용된 첫 번째 기준 필드를 기록.
    """
    result = ImportResult(total_rows=len(rows))
    dedup_field_used: str | None = None

    for idx, row in enumerate(rows):
        row_num = idx + 1

        # ── 행 검증 (DB 없는 순수 파이썬) ────────────────────────────
        name = row.get("name")
        if not name:
            result.error_count += 1
            result.errors.append({"row": row_num, "message": "name 필드가 없거나 비어 있습니다."})
            continue

        ci_type_val = row.get("ci_type")
        if not ci_type_val:
            result.error_count += 1
            result.errors.append({"row": row_num, "message": "ci_type 필드가 없거나 비어 있습니다."})
            continue
        if ci_type_val not in _VALID_CI_TYPE:
            result.error_count += 1
            result.errors.append({
                "row": row_num,
                "message": f"ci_type 값이 유효하지 않습니다: {ci_type_val!r}. "
                           f"허용 값: {sorted(_VALID_CI_TYPE)}",
            })
            continue

        environment_val = row.get("environment") or "production"
        if environment_val not in _VALID_CI_ENV:
            result.error_count += 1
            result.errors.append({
                "row": row_num,
                "message": f"environment 값이 유효하지 않습니다: {environment_val!r}. "
                           f"허용 값: {sorted(_VALID_CI_ENV)}",
            })
            continue

        status_val = row.get("status") or "active"
        if status_val not in _VALID_CI_STATUS:
            result.error_count += 1
            result.errors.append({
                "row": row_num,
                "message": f"status 값이 유효하지 않습니다: {status_val!r}. "
                           f"허용 값: {sorted(_VALID_CI_STATUS)}",
            })
            continue

        criticality_val = row.get("criticality") or "medium"
        if criticality_val not in _VALID_CI_CRITICALITY:
            result.error_count += 1
            result.errors.append({
                "row": row_num,
                "message": f"criticality 값이 유효하지 않습니다: {criticality_val!r}. "
                           f"허용 값: {sorted(_VALID_CI_CRITICALITY)}",
            })
            continue

        hostname = row.get("hostname")
        ip_address = row.get("ip_address")
        os_type = row.get("os_type")
        os_version = row.get("os_version")

        # ── DB 작업: savepoint 격리 ──────────────────────────────────
        _action: str | None = None
        try:
            async with db.begin_nested():
                # dedup 조회: hostname > ip_address > name
                existing: ConfigurationItem | None = None

                if hostname:
                    existing = await db.scalar(
                        select(ConfigurationItem).where(
                            and_(
                                ConfigurationItem.tenant_id == tenant_id,
                                ConfigurationItem.hostname == hostname,
                            )
                        )
                    )
                    if existing is not None and dedup_field_used is None:
                        dedup_field_used = "hostname"

                if existing is None and ip_address:
                    existing = await db.scalar(
                        select(ConfigurationItem).where(
                            and_(
                                ConfigurationItem.tenant_id == tenant_id,
                                ConfigurationItem.ip_address == ip_address,
                            )
                        )
                    )
                    if existing is not None and dedup_field_used is None:
                        dedup_field_used = "ip_address"

                if existing is None:
                    existing = await db.scalar(
                        select(ConfigurationItem).where(
                            and_(
                                ConfigurationItem.tenant_id == tenant_id,
                                ConfigurationItem.name == name,
                            )
                        )
                    )
                    if existing is not None and dedup_field_used is None:
                        dedup_field_used = "name"

                if existing is not None:
                    # UPDATE — 변경이력 기록
                    update_fields: dict[str, Any] = {
                        "ci_type": ci_type_val,
                        "name": name,
                        "hostname": hostname,
                        "ip_address": ip_address,
                        "os_type": os_type,
                        "os_version": os_version,
                        "environment": environment_val,
                        "status": status_val,
                        "criticality": criticality_val,
                    }
                    for fld in _CI_TRACKED:
                        new_val = update_fields.get(fld)
                        old_val = getattr(existing, fld, None)
                        # enum 컬럼은 .value 로 저장됨 — 비교 전 문자열 정규화
                        old_str = _val_to_str(
                            old_val.value if hasattr(old_val, "value") else old_val
                        )
                        new_str = _val_to_str(new_val)
                        if old_str == new_str:
                            continue
                        log = CIChangeLog(
                            id=uuid.uuid4(),
                            tenant_id=tenant_id,
                            ci_id=existing.id,
                            changed_by=user.id,
                            field_name=fld,
                            old_value=old_str,
                            new_value=new_str,
                            change_reason="discovery import",
                        )
                        db.add(log)

                    setattr(existing, "ci_type", ci_type_val)
                    setattr(existing, "name", name)
                    setattr(existing, "hostname", hostname)
                    setattr(existing, "ip_address", ip_address)
                    setattr(existing, "os_type", os_type)
                    setattr(existing, "os_version", os_version)
                    setattr(existing, "environment", environment_val)
                    setattr(existing, "status", status_val)
                    setattr(existing, "criticality", criticality_val)
                    _action = "updated"

                else:
                    # INSERT
                    ci = ConfigurationItem(
                        id=uuid.uuid4(),
                        tenant_id=tenant_id,
                        ci_type=ci_type_val,
                        name=name,
                        hostname=hostname,
                        ip_address=ip_address,
                        os_type=os_type,
                        os_version=os_version,
                        environment=environment_val,
                        status=status_val,
                        criticality=criticality_val,
                        attributes={},
                    )
                    db.add(ci)
                    if dedup_field_used is None:
                        dedup_field_used = "name"
                    _action = "created"

                await db.flush()  # savepoint 내에서 DB 오류 즉시 감지

            # savepoint 정상 해제
            if _action == "created":
                result.created_count += 1
            else:
                result.updated_count += 1

        except Exception as exc:
            logger.warning("CI import row %d 오류: %s", row_num, exc)
            result.error_count += 1
            result.errors.append({"row": row_num, "message": str(exc)})

    result.dedup_key = dedup_field_used
    return result


# ── Asset upsert ────────────────────────────────────────────────────


async def upsert_assets(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    rows: list[dict],
    user: User,
) -> ImportResult:
    """Asset 행 일괄 upsert.

    dedup 키: (tenant_id, asset_tag).
    신규 자산: customer_id 없으면 skipped (모델 NOT NULL 제약).
    기존 자산: model / serial / asset_type 업데이트.
    각 행을 savepoint로 격리.
    """
    result = ImportResult(total_rows=len(rows), dedup_key="asset_tag")

    for idx, row in enumerate(rows):
        row_num = idx + 1

        # ── 행 검증 (DB 없는 순수 파이썬) ────────────────────────────
        asset_tag = row.get("asset_tag")
        if not asset_tag:
            result.error_count += 1
            result.errors.append({
                "row": row_num,
                "message": "asset_tag 필드가 없거나 비어 있습니다 (dedup key 필수).",
            })
            continue

        asset_type_val = row.get("asset_type")
        if asset_type_val and asset_type_val not in _VALID_ASSET_TYPE:
            result.error_count += 1
            result.errors.append({
                "row": row_num,
                "message": f"asset_type 값이 유효하지 않습니다: {asset_type_val!r}. "
                           f"허용 값: {sorted(_VALID_ASSET_TYPE)}",
            })
            continue

        model_val = row.get("model")
        serial_val = row.get("serial")

        # ── DB 작업: savepoint 격리 ──────────────────────────────────
        _action: str | None = None
        try:
            async with db.begin_nested():
                existing: Asset | None = await db.scalar(
                    select(Asset).where(
                        and_(
                            Asset.tenant_id == tenant_id,
                            Asset.asset_tag == asset_tag,
                        )
                    )
                )

                if existing is not None:
                    # UPDATE — 제공된 필드만 업데이트
                    if model_val is not None:
                        existing.model = model_val
                    if serial_val is not None:
                        existing.serial = serial_val
                    if asset_type_val is not None:
                        existing.asset_type = asset_type_val
                    _action = "updated"

                else:
                    # 신규: model + asset_type 필수, customer_id 없으면 skip
                    if not model_val:
                        result.skipped_count += 1
                        result.errors.append({
                            "row": row_num,
                            "message": f"신규 자산 생성 시 model 필드가 필요합니다 (asset_tag={asset_tag!r}).",
                        })
                        _action = "skipped"
                    elif not asset_type_val:
                        result.skipped_count += 1
                        result.errors.append({
                            "row": row_num,
                            "message": f"신규 자산 생성 시 asset_type 필드가 필요합니다 (asset_tag={asset_tag!r}).",
                        })
                        _action = "skipped"
                    else:
                        # customer_id 없으면 skip (모델 NOT NULL 제약)
                        result.skipped_count += 1
                        result.errors.append({
                            "row": row_num,
                            "message": (
                                f"신규 자산(asset_tag={asset_tag!r})은 customer_id가 필요합니다. "
                                "기존 자산만 업데이트됩니다. 직접 자산을 생성 후 재import하세요."
                            ),
                        })
                        _action = "skipped"

                if _action != "skipped":
                    await db.flush()

            # savepoint 정상 해제
            if _action == "updated":
                result.updated_count += 1
            # skipped는 이미 위에서 카운트됨

        except Exception as exc:
            logger.warning("Asset import row %d 오류: %s", row_num, exc)
            result.error_count += 1
            result.errors.append({"row": row_num, "message": str(exc)})

    return result
