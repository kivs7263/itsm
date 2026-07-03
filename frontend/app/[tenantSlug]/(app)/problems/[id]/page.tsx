'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bug, Search, X, Link as LinkIcon, Trash2, AlertCircle, RefreshCw, BookOpen, HelpCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type {
  ProblemDetail,
  ProblemStatus,
  ProblemPriority,
  Ticket,
  TicketsResponse,
  KnownIssue,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// -----------------------------------------------------------------------
// 상수 매핑
// -----------------------------------------------------------------------
const PROBLEM_STATUS_STYLES: Record<ProblemStatus, string> = {
  new:           'bg-neutral-100 text-neutral-500',
  investigating: 'bg-info-bg text-info-text',
  known_error:   'bg-warning-bg text-warning-text',
  resolved:      'bg-success-bg text-success-text',
  closed:        'bg-neutral-100 text-neutral-400',
};

const PROBLEM_STATUS_LABELS: Record<ProblemStatus, string> = {
  new:           '신규',
  investigating: '조사중',
  known_error:   'Known Error',
  resolved:      '해결됨',
  closed:        '종료',
};

const PROBLEM_PRIORITY_STYLES: Record<ProblemPriority, string> = {
  low:      'bg-neutral-100 text-neutral-500',
  medium:   'bg-info-bg text-info-text',
  high:     'bg-warning-bg text-warning-text',
  critical: 'bg-error-bg text-error-text',
};

const PROBLEM_PRIORITY_LABELS: Record<ProblemPriority, string> = {
  low:      '낮음',
  medium:   '보통',
  high:     '높음',
  critical: '긴급',
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  open:        '열림',
  in_progress: '진행중',
  pending:     '대기',
  resolved:    '해결됨',
  closed:      '닫힘',
};

// -----------------------------------------------------------------------
// 배지 컴포넌트
// -----------------------------------------------------------------------
function ProblemStatusBadge({ status }: { status: ProblemStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', PROBLEM_STATUS_STYLES[status])}>
      {PROBLEM_STATUS_LABELS[status]}
    </span>
  );
}

function ProblemPriorityBadge({ priority }: { priority: ProblemPriority }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', PROBLEM_PRIORITY_STYLES[priority])}>
      {PROBLEM_PRIORITY_LABELS[priority]}
    </span>
  );
}

// -----------------------------------------------------------------------
// InfoRow
// -----------------------------------------------------------------------
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border-subtle last:border-0">
      <span className="text-xs text-text-disabled w-24 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-text-primary flex-1">{children}</span>
    </div>
  );
}

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border-default bg-surface">
        <Skeleton className="h-6 w-64" />
      </div>
      <div className="flex-1 p-6 grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        <div className="col-span-2 space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 타입
// -----------------------------------------------------------------------
type TabKey = 'info' | 'rca' | 'linked_tickets' | 'kb_articles';

// -----------------------------------------------------------------------
// 인시던트 링크 검색 컴포넌트
// -----------------------------------------------------------------------
interface TicketSearchProps {
  tenantSlug: string;
  problemId: string;
  linkedIds: Set<string>;
  onLinked: () => void;
}

function TicketSearch({ tenantSlug, problemId, linkedIds, onLinked }: TicketSearchProps) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  const { data: searchResult, isLoading: searchLoading } = useQuery<TicketsResponse>({
    queryKey: ['ticket-search-for-problem', tenantSlug, q],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets`, { params: { search: q, page: 1, page_size: 8 } }).then((r) => r.data),
    enabled: !!q && q.length >= 2 && searching,
  });

  const linkMutation = useMutation({
    mutationFn: (ticketId: string) =>
      api.post(`/${tenantSlug}/problems/${problemId}/tickets`, { ticket_id: ticketId }),
    onSuccess: () => {
      toast.success('인시던트가 연결되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['problem', tenantSlug, problemId] });
      onLinked();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const tickets: Ticket[] = searchResult?.items ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSearching(true); }}
          onBlur={() => setTimeout(() => setSearching(false), 200)}
          onFocus={() => q.length >= 2 && setSearching(true)}
          placeholder="티켓 번호·제목으로 검색..."
          className="h-8 pl-8 pr-3 w-full rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
        />
      </div>

      {/* 검색 결과 */}
      {searching && q.length >= 2 && (
        <div className="rounded-md border border-border-default bg-surface shadow-sm overflow-hidden">
          {searchLoading ? (
            <div className="p-3 text-xs text-text-secondary">검색 중...</div>
          ) : tickets.length === 0 ? (
            <div className="p-3 text-xs text-text-secondary">검색 결과 없음</div>
          ) : (
            <ul>
              {tickets.map((t) => {
                const alreadyLinked = linkedIds.has(t.id);
                return (
                  <li
                    key={t.id}
                    className={cn(
                      'flex items-center justify-between gap-2 px-3 py-2 border-b border-border-subtle last:border-0 text-sm',
                      alreadyLinked ? 'opacity-50' : 'hover:bg-surface-hover cursor-pointer',
                    )}
                  >
                    <span className="flex-1 truncate text-text-primary">
                      <span className="font-mono text-xs text-text-secondary mr-2">
                        {typeof t.ticket_number === 'string' ? t.ticket_number : ''}
                      </span>
                      {typeof t.title === 'string' ? t.title : '-'}
                    </span>
                    <button
                      type="button"
                      disabled={alreadyLinked || linkMutation.isPending}
                      onClick={() => linkMutation.mutate(t.id)}
                      className={cn(
                        'shrink-0 flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                        alreadyLinked
                          ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                          : 'bg-surface-subtle text-text-secondary hover:bg-surface-hover',
                      )}
                    >
                      <LinkIcon size={11} />
                      {alreadyLinked ? '연결됨' : '연결'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 상세 페이지
// -----------------------------------------------------------------------
export default function ProblemDetailPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const id = params?.id as string;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('info');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // RCA/workaround 편집 상태
  const [rootCause, setRootCause] = useState<string | null>(null);
  const [workaround, setWorkaround] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [rcaInitialized, setRcaInitialized] = useState(false);

  // 담당자 후보 목록 (UUID 선택 드롭다운용)
  const { data: assignees = [] } = useQuery<{ id: string; name: string; email: string }[]>({
    queryKey: ['problem-assignees', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/problems/assignees`).then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: problem, isLoading, isError, refetch } = useQuery<ProblemDetail>({
    queryKey: ['problem', tenantSlug, id],
    queryFn: () => api.get(`/${tenantSlug}/problems/${id}`).then((r) => r.data),
    enabled: !!tenantSlug && !!id,
  });

  // 데이터 로드 후 편집 상태 초기화 (최초 1회)
  React.useEffect(() => {
    if (problem && !rcaInitialized) {
      setRootCause(problem.root_cause ?? '');
      setWorkaround(problem.workaround ?? '');
      setAssignedTo(problem.assigned_to ?? '');  // UUID 문자열 또는 ''
      setRcaInitialized(true);
    }
  }, [problem, rcaInitialized]);

  // PATCH 뮤테이션 (RCA/workaround/status/priority 공용)
  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/${tenantSlug}/problems/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('저장되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['problem', tenantSlug, id] });
      queryClient.invalidateQueries({ queryKey: ['problems', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Problem 삭제
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/${tenantSlug}/problems/${id}`),
    onSuccess: () => {
      toast.success('Problem이 삭제되었습니다.');
      router.push(`/${tenantSlug}/problems`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // RX-4c 잔여: Problem ↔ KB "알려진 이슈" 크로스링크.
  // Problem-KbArticle 간 직접 FK는 없음(reviewer 판정: 계층이 다른 별개 데이터) — 단,
  // 연결된 인시던트(Ticket) 경유로 실제 연결이 존재(ProblemTicket → TicketKnownIssue → KbArticle).
  // 기존 /tickets/{id}/known-issues 엔드포인트(tickets/[ticketId]/page.tsx L377과 동일 API) 재사용해 집계.
  const linkedTicketIds = (problem?.linked_tickets ?? []).map((t) => t.ticket_id);
  const kbQueries = useQueries({
    queries: linkedTicketIds.map((ticketId) => ({
      queryKey: ['ticket-known-issues', tenantSlug, ticketId],
      queryFn: () =>
        api.get(`/${tenantSlug}/tickets/${ticketId}/known-issues`).then((r) => {
          const d = r.data;
          return Array.isArray(d) ? (d as KnownIssue[]) : ((d?.items ?? []) as KnownIssue[]);
        }),
      enabled: !!tenantSlug && !!ticketId,
      staleTime: 30_000,
    })),
  });
  const relatedKbArticles: KnownIssue[] = React.useMemo(() => {
    const seen = new Map<string, KnownIssue>();
    for (const q of kbQueries) {
      for (const ki of q.data ?? []) {
        if (!seen.has(ki.id)) seen.set(ki.id, ki);
      }
    }
    return Array.from(seen.values());
  }, [kbQueries]);
  const kbArticlesLoading = kbQueries.some((q) => q.isLoading);

  // 인시던트 언링크
  const unlinkMutation = useMutation({
    mutationFn: (ticketId: string) =>
      api.delete(`/${tenantSlug}/problems/${id}/tickets/${ticketId}`),
    onSuccess: () => {
      toast.success('인시던트 연결이 해제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['problem', tenantSlug, id] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle size={32} className="text-error" />
        <p className="text-sm text-text-secondary">데이터를 불러오지 못했습니다.</p>
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
  if (!problem) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-text-secondary">Problem을 찾을 수 없습니다.</p>
        <Button size="sm" variant="ghost" onClick={() => router.back()}>돌아가기</Button>
      </div>
    );
  }

  // 상태 전이 버튼 목록
  const transitionButtons: React.ReactNode[] = [];

  if (problem.status === 'new') {
    transitionButtons.push(
      <Button
        key="investigate"
        size="sm"
        isLoading={patchMutation.isPending}
        onClick={() => patchMutation.mutate({ status: 'investigating' })}
      >
        조사 시작
      </Button>,
    );
  }

  if (problem.status === 'investigating') {
    transitionButtons.push(
      <Button
        key="known_error"
        size="sm"
        variant="outline"
        isLoading={patchMutation.isPending}
        onClick={() => patchMutation.mutate({ status: 'known_error' })}
      >
        Known Error 등록
      </Button>,
      <Button
        key="resolve"
        size="sm"
        isLoading={patchMutation.isPending}
        onClick={() => patchMutation.mutate({ status: 'resolved' })}
      >
        해결 처리
      </Button>,
    );
  }

  if (problem.status === 'known_error') {
    transitionButtons.push(
      <Button
        key="resolve-ke"
        size="sm"
        isLoading={patchMutation.isPending}
        onClick={() => patchMutation.mutate({ status: 'resolved' })}
      >
        해결 처리
      </Button>,
    );
  }

  if (problem.status === 'resolved') {
    transitionButtons.push(
      <Button
        key="close"
        size="sm"
        variant="outline"
        isLoading={patchMutation.isPending}
        onClick={() => patchMutation.mutate({ status: 'closed' })}
      >
        종료
      </Button>,
    );
  }

  const linkedIds = new Set((problem.linked_tickets ?? []).map((t) => t.ticket_id));

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/problems`)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span>문제 관리</span>
        </button>
        <span className="text-text-disabled">/</span>
        <span className="text-xs text-text-secondary font-mono">
          {typeof problem.problem_number === 'string' ? problem.problem_number : ''}
        </span>
        <h1 className="text-xl font-semibold text-text-primary truncate flex-1">
          {typeof problem.title === 'string' ? problem.title : id}
        </h1>
        <div className="flex items-center gap-2">
          <ProblemStatusBadge status={problem.status} />
          <ProblemPriorityBadge priority={problem.priority} />
          {problem.is_known_error && (
            <span
              title="Known Error: 근본 원인이 파악된 Problem. 해결책이 KB 문서로 등록되면 '알려진 이슈'가 됩니다 — 아래 '관련 KB 문서' 탭 참고."
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-warning-bg text-warning-text"
            >
              Known Error
              <HelpCircle size={11} />
            </span>
          )}
        </div>
        {transitionButtons.length > 0 && (
          <div className="flex items-center gap-2 ml-2">
            {transitionButtons}
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Trash2 size={13} />}
          onClick={() => setDeleteDialogOpen(true)}
          className="text-red-500 hover:text-red-600 hover:bg-red-50"
        >
          삭제
        </Button>
      </div>

      {/* 본문 — 2컬럼 */}
      <div className="flex-1 overflow-auto min-h-0 p-6">
        <div className="grid grid-cols-3 gap-6 h-full">
          {/* 좌측: 기본 요약 카드 */}
          <div className="col-span-1">
            <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(18, 155, 142, 0.12)' }}
                >
                  <Bug size={16} style={{ color: '#129B8E' }} />
                </div>
                <span className="text-sm font-semibold text-text-primary">Problem 요약</span>
              </div>

              <div className="divide-y divide-border-subtle">
                <InfoRow label="번호">
                  <span className="font-mono text-xs">
                    {typeof problem.problem_number === 'string' ? problem.problem_number : '-'}
                  </span>
                </InfoRow>
                <InfoRow label="상태">
                  <ProblemStatusBadge status={problem.status} />
                </InfoRow>
                <InfoRow label="우선순위">
                  <ProblemPriorityBadge priority={problem.priority} />
                </InfoRow>
                <InfoRow label="Known Error">
                  {problem.is_known_error ? (
                    <span
                      title="근본 원인이 파악된 상태. 해결책이 KB 문서로 등록되면 '알려진 이슈'가 됩니다."
                      className="text-warning-text font-medium text-xs"
                    >
                      예
                    </span>
                  ) : (
                    <span className="text-text-disabled text-xs">아니오</span>
                  )}
                </InfoRow>
                {problem.is_known_error && (
                  <InfoRow label="관련 KB">
                    <span className="text-xs">
                      {kbArticlesLoading
                        ? '확인 중...'
                        : relatedKbArticles.length > 0
                          ? `${relatedKbArticles.length}건 연결됨`
                          : <span className="text-text-disabled">등록된 해결책 없음</span>}
                    </span>
                  </InfoRow>
                )}
                <InfoRow label="담당자">
                  {problem.assigned_to
                    ? (() => {
                        const found = assignees.find((u) => u.id === problem.assigned_to);
                        return found
                          ? <span className="text-xs">{found.name}</span>
                          : <span className="text-xs text-text-secondary">{problem.assigned_to}</span>;
                      })()
                    : <span className="text-text-disabled text-xs">미지정</span>}
                </InfoRow>
                <InfoRow label="인시던트">
                  <span className="text-xs">
                    {(problem.linked_tickets ?? []).length}건 연결
                  </span>
                </InfoRow>
                <InfoRow label="생성일">
                  <span className="text-xs">{formatRelativeTime(problem.created_at)}</span>
                </InfoRow>
                <InfoRow label="수정일">
                  <span className="text-xs">{formatRelativeTime(problem.updated_at)}</span>
                </InfoRow>
              </div>

              {/* 우선순위 변경 */}
              <div className="mt-4 flex flex-col gap-1.5">
                <span className="text-xs text-text-secondary font-medium">우선순위 변경</span>
                <Select
                  value={problem.priority}
                  onValueChange={(v) => patchMutation.mutate({ priority: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">낮음</SelectItem>
                    <SelectItem value="medium">보통</SelectItem>
                    <SelectItem value="high">높음</SelectItem>
                    <SelectItem value="critical">긴급</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* 우측: 탭 */}
          <div className="col-span-2">
            <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 h-full flex flex-col">
              {/* 탭 헤더 */}
              <div className="flex border-b border-border-subtle mb-4">
                {([
                  { key: 'info' as TabKey,           label: '기본 정보' },
                  { key: 'rca' as TabKey,            label: 'RCA / 해결책' },
                  { key: 'linked_tickets' as TabKey, label: `연결된 인시던트 (${(problem.linked_tickets ?? []).length})` },
                  { key: 'kb_articles' as TabKey,    label: `관련 KB 문서 (${relatedKbArticles.length})` },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={cn(
                      'px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors whitespace-nowrap',
                      activeTab === key
                        ? 'border-brand text-text-primary'
                        : 'border-transparent text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* 탭 본문 */}
              <div className="flex-1 overflow-auto">

                {/* 기본 정보 탭 */}
                {activeTab === 'info' && (
                  <div className="flex flex-col gap-4">
                    <div className="divide-y divide-border-subtle">
                      <InfoRow label="제목">
                        <span className="font-medium">
                          {typeof problem.title === 'string' ? problem.title : '-'}
                        </span>
                      </InfoRow>
                      <InfoRow label="설명">
                        <span className="text-sm text-text-secondary whitespace-pre-wrap">
                          {typeof problem.description === 'string' && problem.description
                            ? problem.description
                            : <span className="text-text-disabled">-</span>}
                        </span>
                      </InfoRow>
                    </div>
                  </div>
                )}

                {/* RCA / 해결책 탭 */}
                {activeTab === 'rca' && (
                  <div className="flex flex-col gap-5">
                    {/* Root Cause */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-text-secondary">
                        근본 원인 (Root Cause Analysis)
                      </span>
                      <textarea
                        value={rootCause ?? ''}
                        onChange={(e) => setRootCause(e.target.value)}
                        placeholder="장애의 근본 원인을 분석하여 입력하세요"
                        rows={5}
                        className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong resize-none"
                      />
                    </div>

                    {/* Workaround */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-text-secondary">
                        해결책 / 임시 조치 (Workaround)
                      </span>
                      <textarea
                        value={workaround ?? ''}
                        onChange={(e) => setWorkaround(e.target.value)}
                        placeholder="근본 원인 해결 전 임시 대응 방법을 입력하세요"
                        rows={4}
                        className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong resize-none"
                      />
                    </div>

                    {/* 담당자 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-text-secondary">담당자</span>
                      <Select
                        value={assignedTo}
                        onValueChange={(v) => setAssignedTo(v)}
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="담당자 선택">
                            {assignedTo
                              ? assignees.find((u) => u.id === assignedTo)?.name ?? '담당자 선택'
                              : '미지정'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">미지정</SelectItem>
                          {assignees.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 저장 */}
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        isLoading={patchMutation.isPending}
                        onClick={() =>
                          patchMutation.mutate({
                            root_cause:  rootCause  || null,
                            workaround:  workaround || null,
                            assigned_to: assignedTo || null,
                          })
                        }
                      >
                        저장
                      </Button>
                    </div>
                  </div>
                )}

                {/* 연결된 인시던트 탭 */}
                {activeTab === 'linked_tickets' && (
                  <div className="flex flex-col gap-4">
                    {/* 검색/링크 */}
                    <TicketSearch
                      tenantSlug={tenantSlug}
                      problemId={id}
                      linkedIds={linkedIds}
                      onLinked={() => {}}
                    />

                    {/* 연결된 티켓 목록 */}
                    {(problem.linked_tickets ?? []).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <p className="text-sm text-text-secondary">연결된 인시던트가 없습니다.</p>
                        <p className="text-xs text-text-disabled mt-1">
                          위 검색창에서 티켓 번호나 제목으로 검색 후 연결하세요.
                        </p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border-default">
                            <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3 w-24">번호</th>
                            <th className="text-left text-xs font-medium text-text-secondary py-2">제목</th>
                            <th className="text-left text-xs font-medium text-text-secondary py-2 w-20">상태</th>
                            <th className="text-left text-xs font-medium text-text-secondary py-2 w-20">우선순위</th>
                            <th className="py-2 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {(problem.linked_tickets ?? []).map((t) => (
                            <tr key={t.ticket_id} className="border-b border-border-subtle">
                              <td className="py-2.5 pr-3 font-mono text-xs text-text-secondary">
                                {typeof t.ticket_number === 'string' ? t.ticket_number : '-'}
                              </td>
                              <td className="py-2.5 font-medium text-text-primary max-w-[200px] truncate">
                                {typeof t.title === 'string' ? t.title : '-'}
                              </td>
                              <td className="py-2.5">
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-neutral-100 text-neutral-600">
                                  {TICKET_STATUS_LABELS[t.status] ?? t.status}
                                </span>
                              </td>
                              <td className="py-2.5 text-text-secondary text-xs">
                                {t.priority}
                              </td>
                              <td className="py-2.5">
                                <button
                                  type="button"
                                  title="연결 해제"
                                  disabled={unlinkMutation.isPending}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    unlinkMutation.mutate(t.ticket_id);
                                  }}
                                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-error-bg hover:text-error-text text-text-disabled transition-colors"
                                >
                                  <X size={13} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* 관련 KB 문서 탭 — RX-4c 잔여: Problem ↔ KB 알려진 이슈 크로스링크 */}
                {activeTab === 'kb_articles' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2.5 text-xs text-text-secondary">
                      <HelpCircle size={14} className="mt-0.5 shrink-0 text-text-disabled" />
                      <span>
                        Problem(원인 조사 레코드)과 KB &quot;알려진 이슈&quot;(등록된 해결책)는 서로 다른 데이터입니다.
                        여기서는 이 Problem에 연결된 인시던트(티켓)에 등록된 KB 알려진 이슈를 모아 보여줍니다.
                      </span>
                    </div>

                    {kbArticlesLoading ? (
                      <div className="flex flex-col gap-2">
                        {Array.from({ length: 2 }).map((_, i) => (
                          <Skeleton key={i} className="h-14 w-full rounded-lg" />
                        ))}
                      </div>
                    ) : relatedKbArticles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 gap-2">
                        <p className="text-sm text-text-secondary">
                          {linkedTicketIds.length === 0
                            ? '연결된 인시던트가 없어 관련 KB 문서를 찾을 수 없습니다.'
                            : '연결된 인시던트에 등록된 KB 알려진 이슈가 없습니다.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => router.push(`/${tenantSlug}/kb?view=known-issues`)}
                          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
                        >
                          <BookOpen size={12} />
                          KB 알려진 이슈 전체 목록 보기
                        </button>
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {relatedKbArticles.map((ki) => (
                          <li key={ki.id}>
                            <button
                              type="button"
                              onClick={() => router.push(`/${tenantSlug}/kb/${ki.id}`)}
                              className="w-full flex items-center justify-between gap-3 rounded-lg border border-border-default bg-surface px-3 py-2.5 text-left hover:bg-surface-hover hover:border-border-strong transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-text-primary truncate">{ki.title}</p>
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {ki.ki_severity && (
                                    <span className="inline-flex items-center rounded-full bg-error-bg px-1.5 py-0.5 text-[10px] font-medium text-error-text">
                                      {ki.ki_severity}
                                    </span>
                                  )}
                                  {ki.ki_status && (
                                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                                      {ki.ki_status}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ExternalLink size={13} className="shrink-0 text-text-disabled" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Problem 삭제</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-0">
            <p className="text-sm text-text-secondary">
              이 Problem을 삭제합니다. 연결된 인시던트 링크도 함께 제거됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleteMutation.isPending}>
              취소
            </Button>
            <Button
              isLoading={deleteMutation.isPending}
              onClick={() => {
                setDeleteDialogOpen(false);
                deleteMutation.mutate();
              }}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
