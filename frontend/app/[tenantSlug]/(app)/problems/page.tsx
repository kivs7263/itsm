'use client';

import React, { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Bug, AlertCircle, RefreshCw, CheckCircle2, BellOff, BookOpen, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Problem, ProblemStatus, ProblemPriority, ProblemsResponse, RecurringAlert, RecurringAlertsResponse } from '@/lib/types';
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

// -----------------------------------------------------------------------
// 상수 매핑
// -----------------------------------------------------------------------
const PROBLEM_STATUS_STYLES: Record<ProblemStatus, string> = {
  new:          'bg-neutral-100 text-neutral-500',
  investigating: 'bg-info-bg text-info-text',
  known_error:  'bg-warning-bg text-warning-text',
  resolved:     'bg-success-bg text-success-text',
  closed:       'bg-neutral-100 text-neutral-400',
};

const PROBLEM_STATUS_LABELS: Record<ProblemStatus, string> = {
  new:          '신규',
  investigating: '조사중',
  known_error:  'Known Error',
  resolved:     '해결됨',
  closed:       '종료',
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
// 스켈레톤 행
// -----------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 빈 상태
// -----------------------------------------------------------------------
function EmptyState({ onNew, knownErrorOnly }: { onNew: () => void; knownErrorOnly: boolean }) {
  return (
    <tr>
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <Bug size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">
              {knownErrorOnly ? 'Known Error 없음' : '문제 없음'}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {knownErrorOnly
                ? '등록된 Known Error가 없습니다.'
                : '등록된 문제 레코드가 없습니다.'}
            </p>
          </div>
          {!knownErrorOnly && (
            <Button size="sm" onClick={onNew} leftIcon={<Plus size={14} />}>
              새 Problem
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 생성 모달
// -----------------------------------------------------------------------
interface CreateProblemModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

function CreateProblemModal({ open, onClose, tenantSlug }: CreateProblemModalProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ProblemPriority>('medium');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/problems`, {
        title,
        description: description || undefined,
        priority,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Problem이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['problems', tenantSlug] });
      setTitle('');
      setDescription('');
      setPriority('medium');
      onClose();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="text-base font-semibold text-text-primary mb-4">새 Problem 등록</h2>

        <div className="flex flex-col gap-4">
          {/* 제목 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              제목 <span className="text-error-text">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Problem 제목을 입력하세요"
              className="w-full h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </div>

          {/* 설명 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="증상 및 발생 상황을 설명하세요"
              rows={3}
              className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong resize-none"
            />
          </div>

          {/* 우선순위 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">우선순위</label>
            <Select value={priority} onValueChange={(v) => setPriority(v as ProblemPriority)}>
              <SelectTrigger className="h-9 text-sm">
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

        <div className="flex justify-end gap-2 mt-6">
          <Button size="sm" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            isLoading={mutation.isPending}
            disabled={!title.trim()}
            onClick={() => mutation.mutate()}
          >
            등록
          </Button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 반복 감지 탭 (인라인) — RX-4c: /recurring-alerts 페이지 병합
// 반복 이슈 감지 목록·인지(acknowledge)·Problem 생성 전환 이식
// -----------------------------------------------------------------------
function RecurringTab({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<RecurringAlertsResponse>({
    queryKey: ['recurring-alerts', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/recurring-alerts`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) =>
      api.post(`/${tenantSlug}/recurring-alerts/${alertId}/acknowledge`).then((r) => r.data),
    onSuccess: () => {
      toast.success('알림을 인지 처리했습니다.');
      queryClient.invalidateQueries({ queryKey: ['recurring-alerts', tenantSlug] });
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  const createProblemMutation = useMutation({
    mutationFn: (alertId: string) =>
      api.post(`/${tenantSlug}/recurring-alerts/${alertId}/create-problem`).then((r) => r.data),
    onSuccess: (problem) => {
      toast.success('Problem이 생성되었습니다. Problem 페이지로 이동합니다.');
      queryClient.invalidateQueries({ queryKey: ['recurring-alerts', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['problems', tenantSlug] });
      if (problem?.id) {
        router.push(`/${tenantSlug}/problems/${problem.id}`);
      }
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  const alerts: RecurringAlert[] = data?.items ?? [];
  const unacknowledgedCount = alerts.filter((a) => !a.is_acknowledged).length;

  return (
    <div className="flex flex-col flex-1 min-h-0 mt-4">
      {/* 헤더 바 — 미인지 배지 + 수동 새로고침 (refetchInterval 없음, 유일 갱신 수단) */}
      <div className="flex items-center gap-2 px-1 pb-2 shrink-0">
        <span className="text-xs text-text-secondary">반복 장애 알림</span>
        {unacknowledgedCount > 0 && (
          <span className="flex items-center justify-center h-5 min-w-5 rounded-full bg-warning text-white text-[10px] font-bold px-1.5">
            {unacknowledgedCount}
          </span>
        )}
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto shrink-0 flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={12} />
          새로고침
        </button>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">발생 횟수</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">트리거 티켓 수</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">감지 시각</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary">액션</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  <td className="px-4 py-3"><Skeleton className="h-5 w-10 rounded-full" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-7 w-20 rounded-md" /></td>
                </tr>
              ))}
            </>
          ) : isError ? (
            <tr>
              <td colSpan={4} className="px-4 py-16 text-center">
                <AlertCircle size={32} className="mx-auto mb-3 text-error" />
                <p className="text-sm text-text-secondary mb-3">데이터를 불러오지 못했습니다.</p>
                <button
                  onClick={() => refetch()}
                  className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
                >
                  <RefreshCw size={12} />
                  다시 시도
                </button>
              </td>
            </tr>
          ) : alerts.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ background: 'var(--color-success-bg)' }}
                  >
                    <CheckCircle2 size={24} strokeWidth={1.5} style={{ color: 'var(--color-success)' }} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-text-primary">반복 감지된 장애 없음</p>
                    <p className="text-xs text-text-secondary mt-0.5">현재 반복 패턴이 감지된 장애가 없습니다.</p>
                  </div>
                </div>
              </td>
            </tr>
          ) : (
            alerts.map((alert) => (
              <tr
                key={alert.id}
                className={cn(
                  'border-b border-border-subtle transition-colors',
                  alert.is_acknowledged ? 'opacity-50' : 'hover:bg-surface-hover',
                )}
              >
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      alert.occurrence_count >= 5
                        ? 'bg-error-bg text-error-text'
                        : alert.occurrence_count >= 3
                          ? 'bg-warning-bg text-warning-text'
                          : 'bg-info-bg text-info-text',
                    )}
                  >
                    <RefreshCw size={10} />
                    {alert.occurrence_count}회
                  </span>
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs tabular-nums">
                  {alert.trigger_ticket_ids.length}건
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                  {formatRelativeTime(alert.detected_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {alert.is_acknowledged ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success-text">
                        <CheckCircle2 size={12} />
                        인지됨
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<BellOff size={13} />}
                        onClick={() => acknowledgeMutation.mutate(alert.id)}
                        isLoading={acknowledgeMutation.isPending && acknowledgeMutation.variables === alert.id}
                        disabled={acknowledgeMutation.isPending || createProblemMutation.isPending}
                      >
                        인지
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Bug size={13} />}
                      onClick={() => createProblemMutation.mutate(alert.id)}
                      isLoading={createProblemMutation.isPending && createProblemMutation.variables === alert.id}
                      disabled={createProblemMutation.isPending || acknowledgeMutation.isPending}
                      title="반복 장애에서 Problem 생성 (멱등 — 이미 있으면 기존 반환)"
                    >
                      Problem 생성
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 상태 필터 탭
// -----------------------------------------------------------------------
const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: '',             label: '전체' },
  { value: 'new',          label: '신규' },
  { value: 'investigating', label: '조사중' },
  { value: 'known_error',  label: 'Known Error' },
  { value: 'resolved',     label: '해결됨' },
  { value: 'closed',       label: '종료' },
];

// -----------------------------------------------------------------------
// 페이지네이션
// -----------------------------------------------------------------------
function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border-subtle">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        이전
      </Button>
      <span className="text-xs text-text-secondary">
        {page} / {totalPages}
      </span>
      <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        다음
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------
// 문제 관리 목록 페이지
// -----------------------------------------------------------------------
type ProblemsPageTab = 'list' | 'recurring';

export default function ProblemsPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const router = useRouter();
  const searchParams = useSearchParams();

  // RX-4c: /recurring-alerts 병합 — ?tab=recurring 딥링크 진입 (redirect('/problems?tab=recurring'))
  const initialPageTab: ProblemsPageTab = searchParams?.get('tab') === 'recurring' ? 'recurring' : 'list';
  const [pageTab, setPageTab] = useState<ProblemsPageTab>(initialPageTab);

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  // RX-4c 잔여: KB "알려진 이슈" 탭(/kb?view=known-issues)에서 "?filter=known_error"로 진입 시 자동 필터
  const [knownErrorOnly, setKnownErrorOnly] = useState(searchParams?.get('filter') === 'known_error');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<ProblemsResponse>({
    queryKey: ['problems', tenantSlug, statusFilter, knownErrorOnly, search, page],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/problems`, {
          params: {
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(knownErrorOnly ? { is_known_error: true } : {}),
            ...(search ? { search } : {}),
            page,
            page_size: PAGE_SIZE,
          },
        })
        .then((r) => r.data),
    enabled: !!tenantSlug && pageTab === 'list',
  });

  const items: Problem[] = data?.items ?? [];
  const total = data?.total ?? 0;

  function handleTabChange(value: string) {
    setStatusFilter(value === 'known_error' ? 'known_error' : value);
    setKnownErrorOnly(value === 'known_error' ? true : knownErrorOnly);
    setPage(1);
  }

  function handleKnownErrorToggle() {
    setKnownErrorOnly((prev) => !prev);
    if (!knownErrorOnly) {
      setStatusFilter('');
    }
    setPage(1);
  }

  function handleRowClick(problem: Problem) {
    router.push(`/${tenantSlug}/problems/${problem.id}`);
  }

  // 활성 탭 판정
  const activeTab = knownErrorOnly && !statusFilter ? 'known_error'
    : knownErrorOnly && statusFilter === 'known_error' ? 'known_error'
    : statusFilter || '';

  return (
    <div className="flex flex-col h-full">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-text-primary">문제 관리</h1>
          {/* 탭 토글 — RX-4c: 반복 감지(/recurring-alerts) 병합 */}
          <div className="flex gap-0.5 p-0.5 rounded-lg bg-border-subtle">
            <button
              type="button"
              onClick={() => setPageTab('list')}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-fast',
                pageTab === 'list'
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              문제 목록
            </button>
            <button
              type="button"
              onClick={() => setPageTab('recurring')}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-fast',
                pageTab === 'recurring'
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              반복 감지
            </button>
          </div>
          {pageTab === 'list' && total > 0 && (
            <span className="text-xs text-text-secondary bg-surface-subtle px-2 py-0.5 rounded-full">
              {total}
            </span>
          )}
        </div>
        {pageTab === 'list' && (
          <Button size="sm" onClick={() => setCreateOpen(true)} leftIcon={<Plus size={14} />}>
            새 Problem
          </Button>
        )}
      </div>

      {/* 반복 감지 탭 */}
      {pageTab === 'recurring' && <RecurringTab tenantSlug={tenantSlug} />}

      {/* 문제 목록 탭 */}
      {pageTab === 'list' && (
      <>

      {/* 필터 영역 */}
      <div className="shrink-0 border-b border-border-subtle bg-surface">
        {/* 상태 탭 */}
        <div className="flex items-center gap-0 px-6 pt-2">
          {STATUS_TABS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                if (value === 'known_error') {
                  setStatusFilter('known_error');
                  setKnownErrorOnly(true);
                } else {
                  setStatusFilter(value);
                  setKnownErrorOnly(false);
                }
                setPage(1);
              }}
              className={cn(
                'px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors whitespace-nowrap',
                activeTab === value
                  ? 'border-brand text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 검색 + Known Error 토글 */}
        <div className="flex items-center gap-3 px-6 py-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="제목·번호 검색..."
              className="h-8 pl-8 pr-3 w-52 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </div>

          {/* Known Error only 토글 */}
          {!statusFilter.includes('known_error') && (
            <button
              type="button"
              onClick={handleKnownErrorToggle}
              title="Known Error: 근본 원인이 파악된 Problem. 해결책이 KB 문서로 등록되면 '알려진 이슈'가 됩니다."
              className={cn(
                'inline-flex items-center gap-1.5 h-8 rounded-md px-3 text-xs font-medium border transition-colors',
                knownErrorOnly
                  ? 'border-warning-text bg-warning-bg text-warning-text'
                  : 'border-border-default text-text-secondary hover:text-text-primary',
              )}
            >
              <AlertCircle size={13} />
              Known Error만
            </button>
          )}

          {/* RX-4c 잔여: KB "알려진 이슈"(해결책 등록 완료)로 크로스링크 — Known Error(원인 파악)와는 계층이 다른 별개 데이터 */}
          {knownErrorOnly && (
            <button
              type="button"
              onClick={() => router.push(`/${tenantSlug}/kb?view=known-issues`)}
              title="Known Error 중 해결책이 KB 문서로 등록된 항목은 '알려진 이슈' 목록에서 확인할 수 있습니다."
              className="inline-flex items-center gap-1.5 h-8 rounded-md px-3 text-xs font-medium border border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
            >
              <BookOpen size={13} />
              KB 알려진 이슈에서 해결책 찾기
            </button>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary w-28">번호</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">제목</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary w-28">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary w-24">우선순위</th>
              {knownErrorOnly && (
                <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary w-60">해결책(Workaround)</th>
              )}
              <th
                className="px-4 py-3 text-left text-xs font-medium text-text-secondary w-20"
                title="KE(Known Error): 근본 원인이 파악된 Problem. KB에 해결책이 등록되면 '알려진 이슈'가 됩니다."
              >
                <span className="inline-flex items-center gap-1">
                  KE
                  <HelpCircle size={11} className="text-text-disabled" />
                </span>
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary w-28">생성일</th>
            </tr>
          </thead>
          <tbody>
            {isError ? (
              <tr>
                <td colSpan={knownErrorOnly ? 7 : 6} className="px-4 py-16 text-center">
                  <AlertCircle size={32} className="mx-auto mb-3 text-error" />
                  <p className="text-sm text-text-secondary mb-3">데이터를 불러오지 못했습니다.</p>
                  <button
                    onClick={() => refetch()}
                    className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
                  >
                    <RefreshCw size={12} />
                    다시 시도
                  </button>
                </td>
              </tr>
            ) : isLoading ? (
              <SkeletonRows />
            ) : items.length === 0 ? (
              <EmptyState onNew={() => setCreateOpen(true)} knownErrorOnly={knownErrorOnly} />
            ) : (
              items.map((problem) => (
                <tr
                  key={problem.id}
                  onClick={() => handleRowClick(problem)}
                  className={cn(
                    'border-b border-border-subtle cursor-pointer',
                    'hover:bg-surface-hover transition-colors duration-micro',
                  )}
                >
                  <td className="px-4 py-3 text-xs text-text-secondary font-mono">
                    {typeof problem.problem_number === 'string' ? problem.problem_number : '-'}
                  </td>
                  <td className="px-4 py-3 font-medium text-text-primary max-w-[280px] truncate">
                    {typeof problem.title === 'string' ? problem.title : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <ProblemStatusBadge status={problem.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ProblemPriorityBadge priority={problem.priority} />
                  </td>
                  {knownErrorOnly && (
                    <td className="px-4 py-3 text-xs text-text-secondary max-w-[240px] truncate">
                      {typeof problem.workaround === 'string' && problem.workaround
                        ? problem.workaround
                        : <span className="text-text-disabled">-</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-xs text-text-secondary">
                    {problem.is_known_error ? (
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-warning-bg text-warning-text">KE</span>
                    ) : (
                      <span className="text-text-disabled">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">
                    {formatRelativeTime(problem.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />

      {/* 생성 모달 */}
      <CreateProblemModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />
      </>
      )}
    </div>
  );
}
