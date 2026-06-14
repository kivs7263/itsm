"""pgvector 확장 + kb_articles.embedding 컬럼 + IVFFlat 인덱스 추가.

Revision ID: 020_kb_embedding
Revises: 019_known_issues
Create Date: 2026-06-14

설계 노트:
- pgvector: 이미지가 `pgvector/pgvector:pg16` 이므로 확장만 활성화하면 즉시 사용 가능.
  `CREATE EXTENSION IF NOT EXISTS vector` — 멱등성 보장. downgrade에서는 타 테이블 의존 가능성으로
  DROP EXTENSION 생략(KB 외 향후 ticket 임베딩 등 재사용 여지).
- embedding 컬럼: vector(1536) — OpenAI text-embedding-3-small 기본 차원과 호환.
  nullable=True: 신규 KB는 즉시 임베딩이 없을 수 있고, 백그라운드 워커가 비동기 채움.
  ★★ NOT NULL 강제하지 않음 → backfill 없이 즉시 배포 안전.
- IVFFlat 인덱스:
  * pgvector IVFFlat은 `CREATE INDEX CONCURRENTLY` 미지원 — 일반 CREATE INDEX 사용.
  * IVFFlat CREATE INDEX 자체는 트랜잭션 내 실행 가능하지만, 보다 안전하게 트랜잭션을 명시적으로
    COMMIT 후 재진입하는 패턴을 사용(향후 HNSW 전환·대용량 학습 단계 대비).
  * `op.execute("COMMIT")` 로 Alembic 트랜잭션 종료 후 인덱스 생성 → 다음 statement 부터 새 트랜잭션.
  * lists=100 은 0~10만 행 기준 권장값. 데이터 100만+ 시 lists=1000 으로 재학습(REINDEX) 필요.
  * 초기 배포 시 kb_articles 가 비어있거나 소량이어도 인덱스 메타 생성은 성공.
  * 검색 시 cosine 거리(`<=>` 연산자) 사용 가정 → `vector_cosine_ops` opclass.
- downgrade: 인덱스 → 컬럼 순으로 제거. EXTENSION 은 그대로 둔다(공유 자원).
- 운영 영향: vector 확장 로드(짧음), kb_articles 에 ADD COLUMN(메타데이터만, rewrite 없음, 짧은 ACCESS EXCLUSIVE).
"""
from __future__ import annotations

from alembic import op

revision = "020_kb_embedding"
down_revision = "019_known_issues"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) pgvector 확장 활성화 (멱등)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # 2) kb_articles 에 임베딩 컬럼 추가 (nullable)
    op.execute("ALTER TABLE kb_articles ADD COLUMN embedding vector(1536)")

    # 3) IVFFlat 인덱스 생성 — 트랜잭션 외부 실행 패턴
    #    Alembic이 감싼 트랜잭션을 명시적으로 종료한 뒤 인덱스 생성.
    #    asyncpg는 multi-statement 금지이므로 각 statement 를 분리 실행.
    op.execute("COMMIT")
    op.execute(
        "CREATE INDEX ix_kb_articles_embedding "
        "ON kb_articles USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kb_articles_embedding")
    op.execute("ALTER TABLE kb_articles DROP COLUMN IF EXISTS embedding")
    # EXTENSION vector 는 타 객체 의존 가능성으로 DROP 생략
