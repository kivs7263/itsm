"""모든 모델 import — Alembic autogenerate / metadata 등록용.

추가 모델 생성 시 반드시 여기에 import 추가 (env.py가 이 모듈을 import).
"""
from app.models.base import Base, SoftDeleteMixin, TenantMixin, TimestampMixin  # noqa: F401
from app.models.tenant import Tenant  # noqa: F401
from app.models.user import User, UserRole  # noqa: F401
from app.models.team import Team, TeamMember  # noqa: F401
from app.models.customer import Customer, CustomerNote  # noqa: F401
from app.models.customer_contact import CustomerContact  # noqa: F401
# ADR-043: 3정규화 신 모델 (마이그레이션 057)
from app.models.company import Company  # noqa: F401
from app.models.site import Site  # noqa: F401
from app.models.contact import Contact  # noqa: F401
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
    SLABusinessCalendar,
)
from app.models.portal_session import PortalSession  # noqa: F401
from app.models.calendar_event import CalendarEvent  # noqa: F401
from app.models.kb_article import KbArticle  # noqa: F401
from app.models.cmdb import (  # noqa: F401
    ConfigurationItem,
    CIRelationship,
    CIChangeLog,
    CmdbImportRun,
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
from app.models.recurring_alert import RecurringAlert  # noqa: F401
from app.models.ticket_known_issue import TicketKnownIssue  # noqa: F401
from app.models.report import Report, ReportStatus  # noqa: F401
from app.models.tenant_notification_config import TenantNotificationConfig  # noqa: F401
from app.models.escalation import (  # noqa: F401
    SupportTeam,
    SupportTeamMember,
    TicketEscalation,
    EscalationReason,
)
from app.models.external_notification_log import (  # noqa: F401
    ExternalNotificationLog,
    ExtNotifChannel,
    ExtNotifStatus,
)
from app.models.email_inbound_config import EmailInboundConfig  # noqa: F401
from app.models.service_catalog import (  # noqa: F401
    ServiceCategory,
    ServiceOffering,
    ServiceOfferingSubmission,
)
from app.models.problem import Problem, ProblemTicket  # noqa: F401
from app.models.kb_category import KbCategory  # noqa: F401
from app.models.kb_article_version import KbArticleVersion  # noqa: F401
from app.models.cmdb_discovery import DiscoveryRun  # noqa: F401
from app.models.sidebar_pin import SidebarPin  # noqa: F401

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
    # team
    "Team",
    "TeamMember",
    # customer (기존 — 이중쓰기 기간 유지)
    "Customer",
    "CustomerNote",
    "CustomerContact",
    # company / site / contact (ADR-043 신규 — 마이그레이션 057)
    "Company",
    "Site",
    "Contact",
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
    "SLABusinessCalendar",
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
    "CmdbImportRun",
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
    # recurring alerts (P5-3)
    "RecurringAlert",
    # ticket known issues (P5-4)
    "TicketKnownIssue",
    # reports (P6-2)
    "Report",
    "ReportStatus",
    # tenant notification config (P4-3)
    "TenantNotificationConfig",
    # escalation (ESC)
    "SupportTeam",
    "SupportTeamMember",
    "TicketEscalation",
    "EscalationReason",
    # external notification log (ESC)
    "ExternalNotificationLog",
    "ExtNotifChannel",
    "ExtNotifStatus",
    # service catalog (CA-P1-5)
    "ServiceCategory",
    "ServiceOffering",
    "ServiceOfferingSubmission",
    # problem management (CA-P2-4)
    "Problem",
    "ProblemTicket",
    # kb category (RA-C10-B)
    "KbCategory",
    # kb article versioning (RA-C10-B)
    "KbArticleVersion",
    # cmdb discovery runs (RA-C10-A)
    "DiscoveryRun",
    # sidebar pins (ITSM-SIDEBAR-P1)
    "SidebarPin",
]
