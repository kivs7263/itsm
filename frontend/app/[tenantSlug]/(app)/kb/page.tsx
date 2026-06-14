'use client';

import React, { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  KbArticle,
  KbArticlesResponse,
  SemanticSearchResult,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 탭 타입
// -----------------------------------------------------------------------
type SearchTab = 'keyword' | 'semantic';

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function SkeletonCards() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border-subtle bg-surface p-4 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 빈 상태
// -----------------------------------------------------------------------
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(245, 192, 0, 0.12)' }}
      >
        <BookOpen size={28} strokeWidth={1.5} style={{ color: '#F5C000' }} />
      </div>
      <p className="text-sm text-text-secondary">{message}</p>
    </div>
  );
}

// -----------------------------------------------------------------------
// 503 안내 배너
// -----------------------------------------------------------------------
function SemanticUnavailableBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-text">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>
        시맨틱 검색이 설정되지 않았습니다 (OPENAI_API_KEY 미설정).
        키워드 검색 탭을 이용해주세요.
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------
// KB 아티클 카드 (키워드 검색·목록용)
// -----------------------------------------------------------------------
function KbArticleCard({ article }: { article: KbArticle }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 hover:bg-surface-hover transition-colors duration-fast cursor-pointer">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <p className="font-medium text-text-primary line-clamp-1 text-sm">
          {typeof article.title === 'string' ? article.title : '(제목 없음)'}
        </p>
      </div>
      <p className="mt-1.5 text-xs text-text-secondary line-clamp-2">
        {typeof article.content === 'string' ? article.content : ''}
      </p>
      {Array.isArray(article.tags) && article.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {article.tags.slice(0, 4).map((tag) => (
            <span
              key={typeof tag === 'string' ? tag : String(tag)}
              className="inline-flex items-center rounded-full bg-border-subtle px-2 py-0.5 text-[11px] text-text-secondary"
            >
              {typeof tag === 'string' ? tag : String(tag)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 시맨틱 검색 결과 카드
// -----------------------------------------------------------------------
function SemanticResultCard({ result }: { result: SemanticSearchResult }) {
  const similarityPct = Math.round(result.similarity * 100);

  // similarity 색상: 80%+ 초록, 60%+ 노랑, 이하 회색
  const simColor =
    similarityPct >= 80
      ? 'bg-status-resolved-bg text-status-resolved'
      : similarityPct >= 60
        ? 'bg-warning-bg text-warning-text'
        : 'bg-border-subtle text-text-secondary';

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 hover:bg-surface-hover transition-colors duration-fast cursor-pointer">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <p className="font-medium text-text-primary line-clamp-1 text-sm flex-1">
          {typeof result.title === 'string' ? result.title : '(제목 없음)'}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {typeof result.category === 'string' && result.category && (
            <span className="inline-flex items-center rounded-full bg-info-bg text-info-text px-2 py-0.5 text-[11px] font-medium">
              {result.category}
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
              simColor,
            )}
          >
            {similarityPct}% 일치
          </span>
        </div>
      </div>
      {typeof result.content === 'string' && result.content && (
        <p className="mt-1.5 text-xs text-text-secondary line-clamp-2">
          {result.content}
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 키워드 검색 탭 내용
// -----------------------------------------------------------------------
function KeywordTab({
  tenantSlug,
  q,
}: {
  tenantSlug: string;
  q: string;
}) {
  // 검색어 없으면 목록, 있으면 전문 검색
  const isSearching = q.trim().length >= 1;

  const listQuery = useQuery<KbArticlesResponse>({
    queryKey: ['kb-list', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/kb`).then((r) => r.data),
    enabled: !!tenantSlug && !isSearching,
    staleTime: 60_000,
  });

  // Meilisearch 전문 검색 — plain array 반환
  const searchQuery = useQuery<KbArticle[]>({
    queryKey: ['kb-keyword', tenantSlug, q],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/kb/search`, { params: { q } })
        .then((r) => {
          const d = r.data;
          if (Array.isArray(d)) return d as KbArticle[];
          if (Array.isArray(d?.items)) return d.items as KbArticle[];
          return [];
        }),
    enabled: !!tenantSlug && isSearching,
    staleTime: 30_000,
  });

  if (isSearching) {
    if (searchQuery.isLoading) return <SkeletonCards />;
    const results = searchQuery.data ?? [];
    if (results.length === 0) {
      return <EmptyState message={`"${q}"에 대한 검색 결과가 없습니다.`} />;
    }
    return (
      <div className="space-y-2">
        {results.map((article) => (
          <KbArticleCard key={article.id} article={article} />
        ))}
      </div>
    );
  }

  if (listQuery.isLoading) return <SkeletonCards />;
  const items = listQuery.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState message="등록된 지식베이스 문서가 없습니다." />;
  }
  return (
    <div className="space-y-2">
      {items.map((article) => (
        <KbArticleCard key={article.id} article={article} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// 시맨틱 검색 탭 내용
// -----------------------------------------------------------------------
function SemanticTab({
  tenantSlug,
  q,
}: {
  tenantSlug: string;
  q: string;
}) {
  const enabled = !!tenantSlug && q.trim().length >= 2;

  const { data, isLoading, error } = useQuery<SemanticSearchResult[]>({
    queryKey: ['kb-semantic', tenantSlug, q],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/kb/search/semantic`, {
          params: { q: q.trim(), limit: 10 },
        })
        .then((r) => {
          const d = r.data;
          return Array.isArray(d) ? (d as SemanticSearchResult[]) : [];
        }),
    enabled,
    staleTime: 30_000,
    retry: false, // 503 시 재시도 금지
  });

  // 503 응답 감지
  const is503 =
    error !== null &&
    (error as { response?: { status?: number } })?.response?.status === 503;

  if (q.trim().length === 0) {
    return <EmptyState message="검색어를 입력하세요 (2자 이상)." />;
  }

  if (q.trim().length < 2) {
    return <EmptyState message="검색어를 2자 이상 입력하세요." />;
  }

  if (is503) {
    return <SemanticUnavailableBanner />;
  }

  if (isLoading) return <SkeletonCards />;

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-text">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</span>
      </div>
    );
  }

  const results = data ?? [];
  if (results.length === 0) {
    return <EmptyState message={`"${q}"에 대한 의미 검색 결과가 없습니다.`} />;
  }

  return (
    <div className="space-y-2">
      {results.map((result) => (
        <SemanticResultCard key={String(result.id)} result={result} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// KB 페이지
// -----------------------------------------------------------------------
export default function KbPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;

  const [activeTab, setActiveTab] = useState<SearchTab>('keyword');
  const [q, setQ] = useState('');

  const handleTabChange = useCallback((tab: SearchTab) => {
    setActiveTab(tab);
    setQ('');
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">지식베이스</h1>
      </div>

      {/* 탭 + 검색 바 */}
      <div className="px-6 pt-4 pb-3 border-b border-border-subtle bg-surface shrink-0 space-y-3">
        {/* 탭 토글 */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-border-subtle w-fit">
          <button
            type="button"
            onClick={() => handleTabChange('keyword')}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
              activeTab === 'keyword'
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            키워드 검색
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('semantic')}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
              activeTab === 'semantic'
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            의미 검색
          </button>
        </div>

        {/* 검색 입력 */}
        <div className="relative max-w-lg">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              activeTab === 'keyword'
                ? '제목·내용·태그 검색...'
                : '자연어로 검색 (2자 이상)...'
            }
            className="h-9 w-full pl-8 pr-3 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>
      </div>

      {/* 결과 영역 */}
      <div className="flex-1 overflow-auto min-h-0 px-6 py-4">
        {activeTab === 'keyword' ? (
          <KeywordTab tenantSlug={tenantSlug} q={q} />
        ) : (
          <SemanticTab tenantSlug={tenantSlug} q={q} />
        )}
      </div>
    </div>
  );
}
