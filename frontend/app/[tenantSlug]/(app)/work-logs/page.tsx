'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Clock,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Filter,
  ExternalLink,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface WorkLogItem {
  id: string;
  ticket_id: string;
  ticket_number: string | null;
  ticket_title: string | null;
  user_id: string | null;
  user_name: string | null;
  work_type: string;
  hours: number;
  billable: boolean;
  description: string | null;
  completion_status: string | null;
  next_action: string | null;
  logged_at: string;
}

interface Summary {
  total_hours: number;
  billable_hours: number;
  unbillable_hours: number;
  billable_ratio: number;
  log_count: number;
}

interface PageData {
  items: WorkLogItem[];
  total: number;
  page: number;
  page_size: number;
  summary: Summary;
}

interface UserOption {
  id: string;
  name: string | null;
}

const WORK_TYPE_LABELS: Record<string, string> = {
  remote: '원격', onsite: '현장', phone: '전화', email: '이메일', internal: '내부',
};
const COMPLETION_LABELS: Record<string, { label: string; cls: string }> = {
  completed:      { label: '완료',           cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  partial:        { label: '부분 완료',      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  needs_followup: { label: '추가 대응 필요', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

export default function WorkLogsPage() {
  const routeParams = useParams();
  const tenantSlug = routeParams.tenantSlug as string;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || user?.role === 'team_lead';

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterUserId, setFilterUserId] = React.useState('');
  const [filterSince, setFilterSince] = React.useState('');
  const [filterUntil, setFilterUntil] = React.useState('');
  const [filterBillable, setFilterBillable] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 50;

  // ── Queries ────────────────────────────────────────────────────────────────

  const params = new URLSearchParams();
  if (filterUserId)  params.set('user_id',           filterUserId);
  if (filterSince)   params.set('since',             filterSince + 'T00:00:00');
  if (filterUntil)   params.set('until',             filterUntil + 'T23:59:59');
  if (filterBillable) params.set('billable',         filterBillable);
  if (filterStatus)  params.set('completion_status', filterStatus);
  params.set('page',      String(page));
  params.set('page_size', String(PAGE_SIZE));

  const { data, isLoading, isError, error, refetch } = useQuery<PageData>({
    queryKey: ['all-work-logs', tenantSlug, filterUserId, filterSince, filterUntil, filterBillable, filterStatus, page],
    queryFn: () => api.get(`/${tenantSlug}/work-logs?${params.toString()}`).then((r) => r.data),
    staleTime: 30000,
    retry: 1,
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users-list', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/settings/users`).then((r) => {
        const d = r.data;
        if (Array.isArray(d)) return d;
        if (Array.isArray(d?.items)) return d.items;
        return [];
      }),
    enabled: isManager,
    staleTime: 60000,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ logId, ticketId }: { logId: string; ticketId: string }) =>
      api.delete(`/${tenantSlug}/tickets/${ticketId}/work-logs/${logId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-work-logs', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      toast.success('삭제되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const summary = data?.summary;

  function resetFilters() {
    setFilterUserId('');
    setFilterSince('');
    setFilterUntil('');
    setFilterBillable('');
    setFilterStatus('');
    setPage(1);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full gap-0">
      {/* 헤더 */}
      <div className="shrink-0 border-b border-border-default px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">공수 관리</h1>
            <p className="text-sm text-text-secondary mt-0.5">타이머 종료 후 기록된 작업 일지</p>
          </div>
          {summary && (
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <div className="text-xl font-bold text-text-primary tabular-nums">{summary.total_hours}h</div>
                <div className="text-xs text-text-secondary">총 공수</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-green-600 dark:text-green-400 tabular-nums">{summary.billable_hours}h</div>
                <div className="text-xs text-text-secondary">유상</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-text-secondary tabular-nums">{summary.unbillable_hours}h</div>
                <div className="text-xs text-text-secondary">무상</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                  {(summary.billable_ratio * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-text-secondary">유상 비율</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-text-secondary tabular-nums">{summary.log_count}</div>
                <div className="text-xs text-text-secondary">건수</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 필터 바 */}
      <div className="shrink-0 border-b border-border-default bg-surface-elevated px-6 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter size={14} className="text-text-secondary shrink-0" />

          {isManager && (
            <select
              value={filterUserId}
              onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
              className="h-8 rounded-md border border-border-default bg-surface px-2 text-sm text-text-primary min-w-[120px]"
            >
              <option value="">전체 담당자</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.id}</option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={filterSince}
            onChange={(e) => { setFilterSince(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-border-default bg-surface px-2 text-sm text-text-primary"
          />
          <span className="text-text-secondary text-xs">~</span>
          <input
            type="date"
            value={filterUntil}
            onChange={(e) => { setFilterUntil(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-border-default bg-surface px-2 text-sm text-text-primary"
          />

          <select
            value={filterBillable}
            onChange={(e) => { setFilterBillable(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-border-default bg-surface px-2 text-sm text-text-primary"
          >
            <option value="">유/무상 전체</option>
            <option value="true">유상</option>
            <option value="false">무상</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-border-default bg-surface px-2 text-sm text-text-primary"
          >
            <option value="">완료 여부 전체</option>
            <option value="completed">완료</option>
            <option value="partial">부분 완료</option>
            <option value="needs_followup">추가 대응 필요</option>
          </select>

          {(filterUserId || filterSince || filterUntil || filterBillable || filterStatus) && (
            <button
              onClick={resetFilters}
              className="text-xs text-text-secondary hover:text-text-primary underline"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-elevated border-b border-border-default">
            <tr className="text-left text-xs text-text-secondary">
              <th className="px-4 py-2.5 font-medium w-32">티켓</th>
              <th className="px-4 py-2.5 font-medium">수행 내용</th>
              {isManager && <th className="px-4 py-2.5 font-medium w-28">담당자</th>}
              <th className="px-4 py-2.5 font-medium w-16 text-center">공수</th>
              <th className="px-4 py-2.5 font-medium w-20 text-center">유상</th>
              <th className="px-4 py-2.5 font-medium w-20 text-center">유형</th>
              <th className="px-4 py-2.5 font-medium w-24 text-center">완료 여부</th>
              <th className="px-4 py-2.5 font-medium w-28 text-right">기록 일시</th>
              <th className="px-4 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {isError ? (
            <tr>
              <td colSpan={isManager ? 9 : 8} className="px-4 py-16 text-center">
                <AlertCircle size={32} className="mx-auto mb-3 text-red-400" />
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
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-3"><div className="h-4 w-20 bg-surface-hover rounded" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-48 bg-surface-hover rounded" /></td>
                  {isManager && <td className="px-4 py-3"><div className="h-4 w-16 bg-surface-hover rounded" /></td>}
                  <td className="px-4 py-3"><div className="h-4 w-10 bg-surface-hover rounded mx-auto" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-10 bg-surface-hover rounded mx-auto" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-12 bg-surface-hover rounded mx-auto" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-16 bg-surface-hover rounded mx-auto" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-20 bg-surface-hover rounded ml-auto" /></td>
                  <td />
                </tr>
              ))
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={isManager ? 9 : 8} className="px-4 py-16 text-center text-text-secondary text-sm">
                  <Clock size={32} className="mx-auto mb-3 opacity-30" />
                  공수 기록이 없습니다.
                </td>
              </tr>
            ) : (
              data.items.map((log) => {
                const completion = log.completion_status ? COMPLETION_LABELS[log.completion_status] : null;
                return (
                  <tr
                    key={log.id}
                    className="hover:bg-surface-hover group transition-colors"
                  >
                    {/* 티켓 */}
                    <td className="px-4 py-2.5">
                      {log.ticket_number ? (
                        <button
                          onClick={() => router.push(`/${tenantSlug}/tickets?focus=${log.ticket_id}`)}
                          className="flex items-center gap-1 text-brand hover:underline text-xs font-medium"
                        >
                          {log.ticket_number}
                          <ExternalLink size={10} />
                        </button>
                      ) : (
                        <span className="text-text-disabled text-xs">—</span>
                      )}
                      {log.ticket_title && (
                        <p className="text-xs text-text-secondary truncate max-w-[120px] mt-0.5" title={log.ticket_title}>
                          {log.ticket_title}
                        </p>
                      )}
                    </td>

                    {/* 수행 내용 */}
                    <td className="px-4 py-2.5">
                      <p className="text-text-primary line-clamp-2">{log.description ?? '—'}</p>
                      {log.next_action && (
                        <p className="text-xs text-text-secondary mt-0.5">→ {log.next_action}</p>
                      )}
                    </td>

                    {/* 담당자 */}
                    {isManager && (
                      <td className="px-4 py-2.5 text-text-secondary text-xs">
                        {log.user_name ?? '—'}
                      </td>
                    )}

                    {/* 공수 */}
                    <td className="px-4 py-2.5 text-center">
                      <span className="font-semibold tabular-nums text-text-primary">{log.hours}h</span>
                    </td>

                    {/* 유상 */}
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        'text-xs rounded-full px-1.5 py-0.5',
                        log.billable
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-surface-hover text-text-secondary',
                      )}>
                        {log.billable ? '유상' : '무상'}
                      </span>
                    </td>

                    {/* 유형 */}
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-xs text-text-secondary">
                        {WORK_TYPE_LABELS[log.work_type] ?? log.work_type}
                      </span>
                    </td>

                    {/* 완료 여부 */}
                    <td className="px-4 py-2.5 text-center">
                      {completion ? (
                        <span className={cn('text-xs rounded-full px-1.5 py-0.5', completion.cls)}>
                          {completion.label}
                        </span>
                      ) : (
                        <span className="text-text-disabled text-xs">—</span>
                      )}
                    </td>

                    {/* 기록 일시 */}
                    <td className="px-4 py-2.5 text-right text-xs text-text-secondary whitespace-nowrap">
                      {formatRelativeTime(log.logged_at)}
                    </td>

                    {/* 삭제 */}
                    <td className="px-2 py-2.5">
                      <button
                        onClick={() => {
                          if (confirm('이 공수 기록을 삭제하시겠습니까?')) {
                            deleteMutation.mutate({ logId: log.id, ticketId: log.ticket_id });
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 text-text-disabled hover:text-red-500 transition-all p-1"
                        aria-label="삭제"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {data && totalPages > 1 && (
        <div className="shrink-0 border-t border-border-default px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-text-secondary">
            총 {data.total}건 · {page}/{totalPages} 페이지
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-7 w-7 flex items-center justify-center rounded border border-border-default text-text-secondary hover:bg-surface-hover disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-3 text-sm text-text-primary tabular-nums">{page}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-7 w-7 flex items-center justify-center rounded border border-border-default text-text-secondary hover:bg-surface-hover disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
