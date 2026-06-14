"""모든 모델 import — Alembic autogenerate / metadata 등록용.

추가 모델 생성 시 반드시 여기에 import 추가 (env.py가 이 모듈을 import).
"""
from app.models.base import Base, SoftDeleteMixin, TenantMixin, TimestampMixin  # noqa: F401
from app.models.tenant import Tenant  # noqa: F401
from app.models.user import User, UserRole  # noqa: F401
from app.models.sso_config import SSOConfig  # noqa: F401
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.team import Team, TeamMember  # noqa: F401
from app.models.customer import Customer, CustomerNote  # noqa: F401
from app.models.asset import Asset, AssetType  # noqa: F401
from app.models.contract import Contract, ContractType  # noqa: F401
from app.models.ticket import (  # noqa: F401
    Ticket,
    TicketComment,
    TicketAttachment,
    TicketPriority,
    TicketStatus,
    TicketChannel,
    SymptomCategory,
    CauseCategory,
    TicketCause,
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
from app.models.change_request import (  # noqa: F401
    ChangeRequest,
    CRCILink,
    CRChangeType,
    CRStatus,
    CRRiskLevel,
    CRPriority,
)
from app.models.csat_survey import (  # noqa: F401
    CSATSurvey,
    CSATStatus,
)
from app.models.notification_log import (  # noqa: F401
    NotificationLog,
    NotifChannel,
    NotifStatus,
)
from app.models.work_log import TicketWorkLog, WorkType  # noqa: F401
from app.models.reply_template import ReplyTemplate  # noqa: F401

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
    "CustomerNote",
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
    "SymptomCategory",
    "CauseCategory",
    "TicketCause",
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
    # change management
    "ChangeRequest",
    "CRCILink",
    "CRChangeType",
    "CRStatus",
    "CRRiskLevel",
    "CRPriority",
    # csat
    "CSATSurvey",
    "CSATStatus",
    # notification
    "NotificationLog",
    "NotifChannel",
    "NotifStatus",
    # work log
    "TicketWorkLog",
    "WorkType",
    # reply template
    "ReplyTemplate",
]
