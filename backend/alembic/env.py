"""Alembic 환경 — async + 멀티테넌트 모델 등록.

규칙:
- DATABASE_URL 환경변수 우선 (asyncpg 드라이버: postgresql+asyncpg://...).
- 모든 모델은 app.models.__init__에서 일괄 import → metadata 자동 등록.
- ENUM ADD VALUE는 항상 별도 migration으로 분리할 것 (asyncpg 캐시 충돌 방지).
"""
import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# 모든 모델 등록 — Base.metadata에 테이블 등록됨
from app.models import Base  # noqa: F401
import app.models  # noqa: F401  (전체 모델 import 트리거)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.environ.get("DATABASE_URL", "")
config.set_main_option("sqlalchemy.url", database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """오프라인 모드: DB 연결 없이 SQL 출력."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _include_object(obj, name, type_, reflected, compare_to):
    """반영된 테이블 중 모델에 없는 것(뷰·레거시 잔여 테이블)은 비교 제외."""
    if type_ == "table" and reflected and compare_to is None:
        return False
    return True


def _process_revision_directives(context, revision, directives):
    """autogenerate 결과에서 false positive 연산만 제거."""
    from alembic.operations import ops as alembic_ops  # noqa

    if not directives:
        return
    script = directives[0]
    for upgrade_ops in getattr(script, "upgrade_ops_list", []):
        filtered = []
        for op in upgrade_ops.ops:
            if isinstance(op, alembic_ops.ModifyTableOps):
                inner = [
                    o for o in op.ops
                    if not (
                        isinstance(o, alembic_ops.AlterColumnOp)
                        and o.modify_comment is not None
                        and o.modify_nullable is None
                        and o.modify_type is None
                        and o.modify_name is None
                    )
                    and not isinstance(o, (alembic_ops.DropIndexOp, alembic_ops.CreateIndexOp))
                ]
                if inner:
                    op.ops = inner
                    filtered.append(op)
            elif isinstance(op, (alembic_ops.DropIndexOp, alembic_ops.CreateIndexOp)):
                pass  # 인덱스 단독 연산 제거
            else:
                filtered.append(op)
        upgrade_ops.ops = filtered


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=False,
        include_object=_include_object,
        process_revision_directives=_process_revision_directives,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """온라인 모드: asyncpg 비동기 엔진."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
