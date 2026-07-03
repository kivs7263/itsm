'use client';

// -----------------------------------------------------------------------
// DiscoveryView — RX-3c: CMDB SNMP Discovery UI
//
// 백엔드 계약 (backend/app/routers/cmdb.py):
//  POST /{slug}/cmdb/discovery              — cmdb.py:899  (admin/team_lead RBAC)
//  GET  /{slug}/cmdb/discovery/runs         — cmdb.py:1076 (인증 사용자 전원 조회 가능)
//  GET  /{slug}/cmdb/discovery/runs/{id}    — cmdb.py:1109
//
// run.status: pending | running | completed | failed (cmdb.py:887)
// 스캔 시작은 SNMP 오남용 방지를 위해 admin/team_lead만 (백엔드 require_roles와 동일 기준).
// -----------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Radar,
  AlertCircle,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, type UserRole } from '@/lib/auth';
import type {
  Customer,
  CustomersResponse,
  DiscoveryRun,
  DiscoveryRunStatus,
  DiscoveryRunsResponse,
} from '@/lib/types';
import { cn, formatRelativeTime } from '@/lib/utils';
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
// 상태 배지
// -----------------------------------------------------------------------
const STATUS_STYLES: Record<DiscoveryRunStatus, string> = {
  pending:   'bg-neutral-100 text-neutral-500',
  running:   'bg-info-bg text-info-text',
  completed: 'bg-success-bg text-success-text',
  failed:    'bg-error-bg text-error-text',
};

const STATUS_LABELS: Record<DiscoveryRunStatus, string> = {
  pending:   '대기중',
  running:   '진행중',
  completed: '완료',
  failed:    '실패',
};

const STATUS_ICONS: Record<DiscoveryRunStatus, React.ElementType> = {
  pending:   Clock,
  running:   Loader2,
  completed: CheckCircle2,
  failed:    XCircle,
};

function RunStatusBadge({ status }: { status: DiscoveryRunStatus }) {
  const Icon = STATUS_ICONS[status] ?? Clock;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] ?? STATUS_STYLES.pending,
      )}
    >
      <Icon size={11} className={status === 'running' ? 'animate-spin' : undefined} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// -----------------------------------------------------------------------
// 스캔 시작 폼
// -----------------------------------------------------------------------
interface ScanFormState {
  target: string;
  community: string;
  port: string;
  timeout: string;
  customer_id: string;
}

const DEFAULT_FORM: ScanFormState = {
  target: '',
  community: 'public',
  port: '161',
  timeout: '3',
  customer_id: '',
};

function ScanForm({
  tenantSlug,
  canScan,
  onStarted,
}: {
  tenantSlug: string;
  canScan: boolean;
  onStarted: () => void;
}) {
  const [form, setForm] = useState<ScanFormState>(DEFAULT_FORM);

  const { data: customerData } = useQuery<CustomersResponse>({
    queryKey: ['customers', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/customers`).then((r) => r.data),
    enabled: !!tenantSlug && canScan,
  });
  const customers: Customer[] = customerData?.items ?? [];

  const startMutation = useMutation({
    mutationFn: () =>
      api
        .post(`/${tenantSlug}/cmdb/discovery`, {
          target: form.target.trim(),
          community: form.community.trim() || 'public',
          port: Number(form.port) || 161,
          timeout: Number(form.timeout) || 3,
          customer_id: form.customer_id || null,
        })
        .then((r) => r.data as DiscoveryRun),
    onSuccess: (run) => {
      toast.success(`디스커버리를 시작했습니다: ${run.target}`);
      setForm((prev) => ({ ...DEFAULT_FORM, community: prev.community, port: prev.port, timeout: prev.timeout }));
      onStarted();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.target.trim()) {
      toast.error('대상(IP 또는 CIDR)을 입력해주세요.');
      return;
    }
    startMutation.mutate();
  }

  if (!canScan) {
    return (
      <div className="mx-6 mt-4 rounded-lg border border-border-subtle bg-surface-hover px-4 py-3 text-sm text-text-secondary">
        SNMP 디스커버리 스캔은 관리자 또는 팀장만 실행할 수 있습니다. 아래에서 실행 이력은 조회할 수 있습니다.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-6 mt-4 flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-center gap-2">
        <Radar size={16} className="text-brand" />
        <h2 className="text-sm font-semibold text-text-primary">SNMP 디스커버리 시작</h2>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">대상 (IP / CIDR)</label>
          <input
            value={form.target}
            onChange={(e) => setForm((p) => ({ ...p, target: e.target.value }))}
            placeholder="192.168.1.1 또는 192.168.1.0/24"
            className="h-9 w-56 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">커뮤니티</label>
          <input
            value={form.community}
            onChange={(e) => setForm((p) => ({ ...p, community: e.target.value }))}
            placeholder="public"
            className="h-9 w-28 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">포트</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => setForm((p) => ({ ...p, port: e.target.value }))}
            className="h-9 w-20 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">타임아웃(초)</label>
          <input
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            value={form.timeout}
            onChange={(e) => setForm((p) => ({ ...p, timeout: e.target.value }))}
            className="h-9 w-24 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">고객 귀속 (선택)</label>
          <Select
            value={form.customer_id || 'none'}
            onValueChange={(v) => setForm((p) => ({ ...p, customer_id: v === 'none' ? '' : v }))}
          >
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="없음" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">없음</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {typeof c.name === 'string' ? c.name : c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" isLoading={startMutation.isPending} leftIcon={<Radar size={14} />}>
          스캔 시작
        </Button>
      </div>

      <p className="text-xs text-text-disabled">
        단일 호스트는 동기 프로브, CIDR 범위는 비동기 스캔(최대 /24 = 254호스트)으로 처리됩니다.
        SNMP 에이전트가 응답하지 않는 대상은 실패로 기록되며 앱 동작에는 영향을 주지 않습니다.
      </p>
    </form>
  );
}

// -----------------------------------------------------------------------
// 에러 상세 (확장 행)
// -----------------------------------------------------------------------
function ErrorDetail({ errors }: { errors: DiscoveryRun['errors'] }) {
  const [open, setOpen] = useState(false);
  if (!errors || errors.length === 0) return <span className="text-text-disabled">-</span>;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-error-text hover:underline"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        오류 {errors.length}건
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-0.5 rounded-md bg-error-bg px-2 py-1.5 text-[11px] text-error-text">
          {errors.slice(0, 10).map((e, i) => (
            <li key={i} className="font-mono">
              {typeof e.host === 'string' ? e.host : '?'}: {typeof e.message === 'string' ? e.message : '알 수 없는 오류'}
            </li>
          ))}
          {errors.length > 10 && <li>… 외 {errors.length - 10}건</li>}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 페이지네이션 (CIListView와 동일 패턴)
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
      <span className="text-xs text-text-secondary">{page} / {totalPages}</span>
      <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        다음
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------
// 빈 상태
// -----------------------------------------------------------------------
function EmptyState() {
  return (
    <tr>
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <Radar size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">디스커버리 실행 이력 없음</p>
            <p className="mt-1 text-sm text-text-secondary">
              위 폼에서 대상을 입력하고 스캔을 시작하면 여기에 이력이 표시됩니다.
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-10" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-10" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// DiscoveryView 본체
// -----------------------------------------------------------------------
export function DiscoveryView() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canScan = isTeamLeadOrAbove(user?.role as UserRole);

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery<DiscoveryRunsResponse>({
    queryKey: ['discovery-runs', tenantSlug, page],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/cmdb/discovery/runs`, { params: { page, page_size: PAGE_SIZE } })
        .then((r) => r.data),
    enabled: !!tenantSlug,
    // 진행중(pending/running) run이 있으면 3초 간격 폴링, 없으면 폴링 중단
    refetchInterval: (query) => {
      const items = (query.state.data as DiscoveryRunsResponse | undefined)?.items ?? [];
      const hasActive = items.some((r) => r.status === 'pending' || r.status === 'running');
      return hasActive ? 3000 : false;
    },
  });

  const runs: DiscoveryRun[] = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  // run이 running/pending → completed/failed로 전환되면 CI 목록·자산 캐시 무효화
  // (신규 발견 CI가 CI 탭에 반영되도록)
  const prevStatuses = useRef<Map<string, DiscoveryRunStatus>>(new Map());
  useEffect(() => {
    let shouldInvalidate = false;
    for (const run of runs) {
      const prev = prevStatuses.current.get(run.id);
      if (prev && (prev === 'pending' || prev === 'running') && (run.status === 'completed' || run.status === 'failed')) {
        shouldInvalidate = true;
      }
      prevStatuses.current.set(run.id, run.status);
    }
    if (shouldInvalidate) {
      queryClient.invalidateQueries({ queryKey: ['cmdb-cis', tenantSlug] });
    }
  }, [runs, queryClient, tenantSlug]);

  return (
    <div className="flex flex-col h-full">
      <ScanForm
        tenantSlug={tenantSlug}
        canScan={canScan}
        onStarted={() => {
          setPage(1);
          queryClient.invalidateQueries({ queryKey: ['discovery-runs', tenantSlug] });
        }}
      />

      <div className="flex-1 overflow-auto min-h-0 mt-4">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">대상</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">발견</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">오류</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">시작</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">종료</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
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
            ) : runs.length === 0 ? (
              <EmptyState />
            ) : (
              runs.map((run) => (
                <tr key={run.id} className="border-b border-border-subtle">
                  <td className="px-4 py-3 font-medium text-text-primary font-mono text-xs">
                    {typeof run.target === 'string' ? run.target : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <RunStatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{run.discovered_count}</td>
                  <td className="px-4 py-3 text-xs">
                    <ErrorDetail errors={run.errors} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {run.started_at ? formatRelativeTime(run.started_at) : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {run.finished_at ? formatRelativeTime(run.finished_at) : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}
