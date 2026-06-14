"""테넌트별 알림 채널 설정 테이블 신규 생성: tenant_notification_configs.

Revision ID: 023_tenant_notification_config
Revises: 022_customer_contacts
Create Date: 2026-06-14

설계 노트:
- 목적: Slack/Teams/Kakao/SMS 채널 자격증명을 env var 대신 DB에 저장 → Settings 페이지에서
  테넌트 관리자가 직접 관리. env var 방식은 하위 호환 유지 (서비스 레이어에서 우선순위 결정).
- tenant_id: UNIQUE + FK ON DELETE CASCADE → 테넌트당 단일 설정 행, 테넌트 삭제 시 자동 정리.
  UNIQUE 제약이 자동 인덱스 생성 → 별도 ix_tenant_id 불필요.
- 모든 자격증명 컬럼은 nullable (TEXT/VARCHAR) → 미설정 = NULL. 부분 설정 허용
  (예: Slack 만 사용, SMS 미사용). 채널 활성 여부 판정은 서비스 레이어 담당.
- TEXT 사용 이유: webhook URL/API key 길이 제약 불확실 (Slack/Teams URL 200~300자, Kakao
  sender_key 등 외부 발급값) → VARCHAR(N) 제약 시 향후 외부 사양 변경에 취약.
- sms_from_number 만 VARCHAR(30): E.164 국제 형식 최대 15자 + 포맷 여유. 짧고 안정적 사양.
- 자격증명 컬럼명 형식 통일: `{channel}_{purpose}` — Slack/Teams 는 webhook_url 단일, Kakao/SMS
  는 api_key + 보조키. 향후 채널 추가 시 동일 컨벤션 유지.
- created_at / updated_at: TIMESTAMPTZ(`DateTime(timezone=True)`) — UTC 보장.
- ★★ 보안 노트: 자격증명 평문 저장. 운영 환경에서는 애플리케이션 레이어 암호화
  (envelope encryption) 또는 pgcrypto 권장 — 후속 마이그레이션에서 컬럼 타입 변경 가능.
- ★★ Settings UI 노트: GET 시 자격증명 필드는 마스킹(예: `••••••`) 또는 보유 여부 boolean
  으로 응답 → 평문 응답 금지. 업데이트는 빈 값이면 기존 값 유지하는 PATCH 시맨틱.
- downgrade: 단순 DROP TABLE. 인덱스/제약은 테이블과 함께 제거됨.
- 운영 영향: 신규 테이블 생성만 — 잠금 영향 없음.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "023_tenant_notification_config"
down_revision = "022_customer_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_notification_configs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("slack_webhook_url", sa.Text(), nullable=True),
        sa.Column("teams_webhook_url", sa.Text(), nullable=True),
        sa.Column("kakao_api_key", sa.Text(), nullable=True),
        sa.Column("kakao_sender_key", sa.Text(), nullable=True),
        sa.Column("sms_api_key", sa.Text(), nullable=True),
        sa.Column("sms_api_secret", sa.Text(), nullable=True),
        sa.Column("sms_from_number", sa.String(30), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("tenant_notification_configs")
