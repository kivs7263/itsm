'use client';

import React, { useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search, AlertTriangle, Plus, AlertCircle, RefreshCw, HelpCircle, Bug, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  KbArticle,
  KbArticlesResponse,
  SemanticSearchResult,
  KnownIssue,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, type UserRole } from '@/lib/auth';
import { CreateKbModal } from '@/components/kb/CreateKbModal';

// -----------------------------------------------------------------------
// 탭 타입 — RX-4c 잔여: 'known-issues' 탭 추가 (?view=known-issues 딥링크)
// -----------------------------------------------------------------------
type SearchTab = 'keyword' | 'semantic' | 'known-issues';

const KI_STATUS_LABELS: Record<string, string> = {
  open: '미해결',
  in_progress: '조치중',
  resolved: '해결됨',
};

// -----------------------------------------------------------------------
// 작성자 역할 확인 (engineer 이상)
// -----------------------------------------------------------------------
function canWrite(role: string | undefined): boolean {
  return ['engineer', 'team_lead', 'admin'].includes(role ?? '');
}

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function SkeletonCards() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 space-y-2">
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
function EmptyState({
  message,
  showCta,
  onNew,
}: {
  message: string;
  showCta?: boolean;
  onNew?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(18, 155, 142, 0.12)' }}
      >
        <BookOpen size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
      </div>
      <div className="text-center">
        <p className="text-sm text-text-secondary">{message}</p>
      </div>
      {showCta && onNew && (
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={onNew}>
          첫 문서 작성하기
        </Button>
      )}
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
function KbArticleCard({
  article,
  onClick,
}: {
  article: KbArticle;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 hover:bg-surface-hover hover:border-border-default transition-all duration-fast"
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <p className="font-medium text-text-primary line-clamp-1 text-sm">
          {typeof article.title === 'string' ? article.title : '(제목 없음)'}
        </p>
        {!article.is_published && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-border-subtle px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            초안
          </span>
        )}
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
    </button>
  );
}

// -----------------------------------------------------------------------
// 시맨틱 검색 결과 카드
// -----------------------------------------------------------------------
function SemanticResultCard({
  result,
  onClick,
}: {
  result: SemanticSearchResult;
  onClick: () => void;
}) {
  const similarityPct = Math.round(result.similarity * 100);

  const simColor =
    similarityPct >= 80
      ? 'bg-status-resolved-bg text-status-resolved'
      : similarityPct >= 60
        ? 'bg-warning-bg text-warning-text'
        : 'bg-border-subtle text-text-secondary';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 hover:bg-surface-hover hover:border-border-default transition-all duration-fast"
    >
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
    </button>
  );
}

// -----------------------------------------------------------------------
// 키워드 검색 탭 내용
// -----------------------------------------------------------------------
function KeywordTab({
  tenantSlug,
  q,
  onArticleClick,
  onNew,
  canCreate,
}: {
  tenantSlug: string;
  q: string;
  onArticleClick: (id: string) => void;
  onNew: () => void;
  canCreate: boolean;
}) {
  const isSearching = q.trim().length >= 1;

  const listQuery = useQuery<KbArticlesResponse>({
    queryKey: ['kb-list', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/kb`).then((r) => r.data),
    enabled: !!tenantSlug && !isSearching,
    staleTime: 60_000,
  });

  const searchQuery = useQuery<KbArticle[]>({
    queryKey: ['kb-keyword', tenantSlug, q],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/kb/search`, { params: { q } })
        .then((r) => (r.data?.items ?? []) as KbArticle[]),
    enabled: !!tenantSlug && isSearching,
    staleTime: 30_000,
  });

  if (isSearching) {
    if (searchQuery.isLoading) return <SkeletonCards />;
    if (searchQuery.isError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <AlertCircle size={28} className="text-error" />
          <p className="text-sm text-text-secondary">검색 중 오류가 발생했습니다.</p>
          <button
            onClick={() => searchQuery.refetch()}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
          >
            <RefreshCw size={12} />
            다시 시도
          </button>
        </div>
      );
    }
    const results = searchQuery.data ?? [];
    if (results.length === 0) {
      return <EmptyState message={`"${q}"에 대한 검색 결과가 없습니다.`} />;
    }
    return (
      <div className="space-y-2">
        {results.map((article) => (
          <KbArticleCard
            key={article.id}
            article={article}
            onClick={() => onArticleClick(article.id)}
          />
        ))}
      </div>
    );
  }

  if (listQuery.isLoading) return <SkeletonCards />;
  if (listQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle size={28} className="text-error" />
        <p className="text-sm text-text-secondary">데이터를 불러오지 못했습니다.</p>
        <button
          onClick={() => listQuery.refetch()}
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
        >
          <RefreshCw size={12} />
          다시 시도
        </button>
      </div>
    );
  }
  const items = listQuery.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        message="등록된 지식베이스 문서가 없습니다."
        showCta={canCreate}
        onNew={onNew}
      />
    );
  }
  return (
    <div className="space-y-2">
      {items.map((article) => (
        <KbArticleCard
          key={article.id}
          article={article}
          onClick={() => onArticleClick(article.id)}
        />
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
  onArticleClick,
}: {
  tenantSlug: string;
  q: string;
  onArticleClick: (id: string) => void;
}) {
  const enabled = !!tenantSlug && q.trim().length >= 2;

  const { data, isLoading, error, refetch } = useQuery<SemanticSearchResult[]>({
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
    retry: false,
  });

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
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-text">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</span>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
        >
          <RefreshCw size={12} />
          다시 시도
        </button>
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
        <SemanticResultCard
          key={String(result.id)}
          result={result}
          onClick={() => onArticleClick(String(result.id))}
        />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// 알려진 이슈 탭 — RX-4c 잔여: KB "알려진 이슈"(해결책 등록 완료) ↔ Problem "Known Error"(원인 파악)
// 계층이 다른 별개 데이터임을 명료화 + Problem 쪽으로 크로스링크
// -----------------------------------------------------------------------
function KnownIssuesTab({
  tenantSlug,
  onArticleClick,
  onGoToProblems,
}: {
  tenantSlug: string;
  onArticleClick: (id: string) => void;
  onGoToProblems: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery<KnownIssue[]>({
    queryKey: ['kb-known-issues', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/kb/known-issues`).then((r) => {
        const d = r.data;
        return Array.isArray(d) ? (d as KnownIssue[]) : ((d?.items ?? []) as KnownIssue[]);
      }),
    enabled: !!tenantSlug,
    staleTime: 30_000,
  });

  const items = data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* 용어 명료화 배너 */}
      <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3 text-xs text-text-secondary">
        <HelpCircle size={14} className="mt-0.5 shrink-0 text-text-disabled" />
        <span className="flex-1">
          &quot;알려진 이슈&quot;는 해결책(Workaround)이 KB 문서로 등록 완료된 항목입니다.
          아직 원인 조사 중이거나 해결책이 없는 항목은 문제 관리의 <strong>Known Error</strong>에서 확인하세요.
        </span>
        <button
          type="button"
          onClick={onGoToProblems}
          className="shrink-0 inline-flex items-center gap-1 text-brand hover:underline font-medium whitespace-nowrap"
        >
          <Bug size={12} />
          문제 관리에서 보기
        </button>
      </div>

      {isLoading ? (
        <SkeletonCards />
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <AlertCircle size={28} className="text-error" />
          <p className="text-sm text-text-secondary">데이터를 불러오지 못했습니다.</p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
          >
            <RefreshCw size={12} />
            다시 시도
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState message="등록된 알려진 이슈가 없습니다." />
      ) : (
        <div className="space-y-2">
          {items.map((ki) => (
            <button
              key={ki.id}
              type="button"
              onClick={() => onArticleClick(ki.id)}
              className="w-full text-left bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 hover:bg-surface-hover hover:border-border-default transition-all duration-fast flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary line-clamp-1 text-sm">
                  {typeof ki.title === 'string' ? ki.title : '(제목 없음)'}
                </p>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {ki.ki_severity && (
                    <span className="inline-flex items-center rounded-full bg-error-bg px-2 py-0.5 text-[11px] font-medium text-error-text">
                      {ki.ki_severity}
                    </span>
                  )}
                  {ki.ki_status && (
                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                      {KI_STATUS_LABELS[ki.ki_status] ?? ki.ki_status}
                    </span>
                  )}
                </div>
              </div>
              <ExternalLink size={14} className="shrink-0 text-text-disabled" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// KB 페이지
// -----------------------------------------------------------------------
export default function KbPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantSlug = params?.tenantSlug as string;
  const { user } = useAuth();

  // RX-4c 잔여: /problems "KB 알려진 이슈에서 해결책 찾기" → ?view=known-issues 딥링크 진입
  const initialTab: SearchTab = searchParams?.get('view') === 'known-issues' ? 'known-issues' : 'keyword';
  const [activeTab, setActiveTab] = useState<SearchTab>(initialTab);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const handleTabChange = useCallback((tab: SearchTab) => {
    setActiveTab(tab);
    setQ('');
  }, []);

  const handleArticleClick = useCallback((id: string) => {
    router.push(`/${tenantSlug}/kb/${id}`);
  }, [router, tenantSlug]);

  const writerAccess = canWrite(user?.role);

  return (
    <div className="flex flex-col h-full">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">지식베이스</h1>
        {writerAccess && (
          <Button
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() => setCreateOpen(true)}
          >
            새 문서
          </Button>
        )}
      </div>

      {/* 탭 + 검색 바 */}
      <div className="px-6 pt-4 pb-3 border-b border-border-subtle bg-surface shrink-0 space-y-3">
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
          {/* RX-4c 잔여: 알려진 이슈 탭 */}
          <button
            type="button"
            onClick={() => handleTabChange('known-issues')}
            title="해결책이 KB 문서로 등록 완료된 항목 (Known Error와는 별개 데이터)"
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
              activeTab === 'known-issues'
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            알려진 이슈
          </button>
        </div>

        {activeTab !== 'known-issues' && (
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
        )}
      </div>

      {/* 결과 영역 */}
      <div className="flex-1 overflow-auto min-h-0 px-6 py-4">
        {activeTab === 'keyword' ? (
          <KeywordTab
            tenantSlug={tenantSlug}
            q={q}
            onArticleClick={handleArticleClick}
            onNew={() => setCreateOpen(true)}
            canCreate={writerAccess}
          />
        ) : activeTab === 'semantic' ? (
          <SemanticTab
            tenantSlug={tenantSlug}
            q={q}
            onArticleClick={handleArticleClick}
          />
        ) : (
          <KnownIssuesTab
            tenantSlug={tenantSlug}
            onArticleClick={handleArticleClick}
            onGoToProblems={() => router.push(`/${tenantSlug}/problems?filter=known_error`)}
          />
        )}
      </div>

      <CreateKbModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
