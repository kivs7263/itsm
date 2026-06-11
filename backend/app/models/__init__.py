"""모든 모델 import — Alembic autogenerate / metadata 등록용.

추가 모델 생성 시 반드시 여기에 import 추가 (env.py가 이 모듈을 import).
"""
from app.models.base import Base, SoftDeleteMixin, TenantMixin, TimestampMixin  # noqa: F401
from app.models.tenant import Tenant  # noqa: F401
from app.models.user import User, UserRole  # noqa: F401
from app.models.sso_config import SSOConfig  # noqa: F401
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.team import Team, TeamMember  # noqa: F401
from app.models.customer import Customer  # noqa: F401
from app.models.asset import Asset, AssetType  # noqa: F401
from app.models.contract import Contract, ContractType  # noqa: F401
from app.models.ticket import (  # noqa: F401
    Ticket,
    TicketComment,
    TicketAttachment,
    TicketPriority,
    TicketStatus,
    TicketChannel,
)
from app.models.sla import (  # noqa: F401
    SLAPolicy,
    SLAEvent,
    SLAGrade,
    SLAEventType,
)
from app.models.portal_session import PortalSession  # noqa: F401
from app.models.calendar_event import CalendarEvent  # noqa: F401
from app.models.kb_article import KbArticle  # noqa: F401
from app.models.cmdb import (  # noqa: F401
    ConfigurationItem,
    CIRelationship,
    CIChangeLog,
    CIType,
    CIEnvironment,
    CIStatus,
    CICriticality,
    CIRelType,
)

__all__ = [
    "Base",
    "TenantMixin",
    "TimestampMixin",
    "SoftDeleteMixin",
    # tenant
    "Tenant",
    # user
    "User",
    "UserRole",
    # sso
    "SSOConfig",
    # audit
    "AuditLog",
    # team
    "Team",
    "TeamMember",
    # customer
    "Customer",
    # asset
    "Asset",
    "AssetType",
    # contract
    "Contract",
    "ContractType",
    # ticket
    "Ticket",
    "TicketComment",
    "TicketAttachment",
    "TicketPriority",
    "TicketStatus",
    "TicketChannel",
    # sla
    "SLAPolicy",
    "SLAEvent",
    "SLAGrade",
    "SLAEventType",
    # portal
    "PortalSession",
    # calendar
    "CalendarEvent",
    # kb
    "KbArticle",
    # cmdb
    "ConfigurationItem",
    "CIRelationship",
    "CIChangeLog",
    "CIType",
    "CIEnvironment",
    "CIStatus",
    "CICriticality",
    "CIRelType",
]
