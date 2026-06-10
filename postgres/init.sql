-- ITSM PostgreSQL 초기화
-- pgvector extension 활성화 (KB 의미검색 대비)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
