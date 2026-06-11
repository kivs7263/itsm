"""CMDB 모델 — ConfigurationItem, CIRelationship, CIChangeLog.

설계 노트:
- ENUM은 migration 006 에서 생성되며 모델 선언은 동일 name + 동일 값 순서 유지.
- 멀티테넌트: 모든 테이블 tenant_id NOT NULL + (tenant_id, ...) 복합 인덱스.
- self-referential FK: from_ci_id / to_ci_id 는 configuration_items.id 참조.
- TIMESTAMPTZ 컬럼 기본값은 base.utcnow() 함수 사용 (datetime.utcnow() 금지).
- DESC 인덱스: Index(name, text("col DESC")) — autogenerate 삭제 감지 방지.
"""
from __future__ import annotations

import enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow


# ----------------------------------------------------------------------
# Python enums (코드 체인 동기화용 — 서비스/Pydantic 레이어에서 import)
# ----------------------------------------------------------------------
class CIType(str, enum.Enum):
    server = "server"
    workstation = "workstation"
    network_device = "network_device"
    application = "application"
    service = "service"
    database = "database"
    virtual_machine = "virtual_machine"
    cloud_resource = "cloud_resource"
    storage = "storage"
    firewall = "firewall"
    router_switch = "router_switch"
    printer = "printer"


class CIEnvironment(str, enum.Enum):
    production = "production"
    staging = "staging"
    development = "development"
    test = "test"


class CIStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"
    decommissioned = "decommissioned"


class CICriticality(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class CIRelType(str, enum.Enum):
    depends_on = "depends_on"
    hosted_on = "hosted_on"
    runs_on = "runs_on"
    connects_to = "connects_to"
    part_of = "part_of"
    manages = "manages"
    backed_up_to = "backed_up_to"


# ----------------------------------------------------------------------
# SQLAlchemy ENUM 컬럼 정의 (create_type=False — migration 에서 이미 생성)
# ----------------------------------------------------------------------
_ci_type_enum = Enum(
    "server",
    "workstation",
    "network_device",
    "application",
    "service",
    "database",
    "virtual_machine",
    "cloud_resource",
    "storage",
    "firewall",
    "router_switch",
    "printer",
    name="ci_type_enum",
    create_type=False,
)
_ci_env_enum = Enum(
    "production",
    "staging",
    "development",
    "test",
    name="ci_env_enum",
    create_type=False,
)
_ci_status_enum = Enum(
    "active",
    "inactive",
    "maintenance",
    "decommissioned",
    name="ci_status_enum",
    create_type=False,
)
_ci_criticality_enum = Enum(
    "critical",
    "high",
    "medium",
    "low",
    name="ci_criticality_enum",
    create_type=False,
)
_ci_rel_type_enum = Enum(
    "depends_on",
    "hosted_on",
    "runs_on",
    "connects_to",
    "part_of",
    "manages",
    "backed_up_to",
    name="ci_rel_type_enum",
    create_type=False,
)


# ----------------------------------------------------------------------
# ConfigurationItem
# ----------------------------------------------------------------------
class ConfigurationItem(Base):
    __tablename__ = "configuration_items"
    __table_args__ = (
        Index("ix_ci_tenant_type", "tenant_id", "ci_type"),
        Index("ix_ci_tenant_status", "tenant_id", "status"),
        Index("ix_ci_tenant_customer", "tenant_id", "customer_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    ci_type = Column(_ci_type_enum, nullable=False)
    name = Column(String(500), nullable=False)
    hostname = Column(String(500), nullable=True)
    ip_address = Column(String(50), nullable=True)
    os_type = Column(String(200), nullable=True)
    os_version = Column(String(200), nullable=True)
    environment = Column(
        _ci_env_enum,
        nullable=False,
        default=CIEnvironment.production,
    )
    status = Column(
        _ci_status_enum,
        nullable=False,
        default=CIStatus.active,
    )
    criticality = Column(
        _ci_criticality_enum,
        nullable=False,
        default=CICriticality.medium,
    )
    owner_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
    )
    attributes = Column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


# ----------------------------------------------------------------------
# CIRelationship  (self-referential)
# ----------------------------------------------------------------------
class CIRelationship(Base):
    __tablename__ = "ci_relationships"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "from_ci_id",
            "to_ci_id",
            "rel_type",
            name="uq_ci_rel",
        ),
        Index("ix_ci_rel_from", "tenant_id", "from_ci_id"),
        Index("ix_ci_rel_to", "tenant_id", "to_ci_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_ci_id = Column(
        UUID(as_uuid=True),
        ForeignKey("configuration_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    to_ci_id = Column(
        UUID(as_uuid=True),
        ForeignKey("configuration_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    rel_type = Column(_ci_rel_type_enum, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )


# ----------------------------------------------------------------------
# CIChangeLog
# ----------------------------------------------------------------------
class CIChangeLog(Base):
    __tablename__ = "ci_change_log"
    __table_args__ = (
        Index("ix_ci_change_log_tenant_ci", "tenant_id", "ci_id"),
        # DESC 인덱스 — 최신순 페이징
        Index(
            "ix_ci_change_log_tenant_created",
            "tenant_id",
            text("created_at DESC"),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    ci_id = Column(
        UUID(as_uuid=True),
        ForeignKey("configuration_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    changed_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    field_name = Column(String(100), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    change_reason = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
