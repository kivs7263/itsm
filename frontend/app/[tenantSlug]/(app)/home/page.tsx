'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LifeBuoy,
  Clock,
  Star,
  AlertTriangle,
  Users,
  TrendingUp,
  CheckCircle2,
  BarChart2,
  Play,
  Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ReportSummary, Ticket } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isSales, isCLevel, type UserRole } from '@/lib/auth';
import { formatRelativeTime } from '@/lib/utils';
import type { TicketPriority, TicketStatus } from '@/lib/types';

// -----------------------------------------------------------------------
// 공통 카드 래퍼 — shadow-md 포함
// -----------------------------------------------------------------------
function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border-default bg-surface shadow-[var(--shadow-card)] overflow-hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------
// 우선순위 Badge 매핑
// -----------------------------------------------------------------------
function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const map: Record<TicketPriority, { label: string; variant: 'destructive' | 'warning' | 'default' }> = {
    critical: { label: '긴급', variant: 'destructive' },
    high:     { label: '높음', variant: 'destructive' },
    medium:   { label: '보통', variant: 'warning' },
    low:      { label: '낮음', variant: 'default' },
  };
  const { label, variant } = map[priority] ?? { label: priority, variant: 'default' };
  return <Badge variant={variant}>{label}</Badge>;
}

// -----------------------------------------------------------------------
// 상태 Badge 매핑
// -----------------------------------------------------------------------
function StatusBadge({ status }: { status: TicketStatus }) {
  const map: Record<TicketStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'default' }> = {
    open:        { label: '열림',    variant: 'info' },
    in_progress: { label: '진행중',  variant: 'warning' },
    pending:     { label: '대기',    variant: 'default' },
    resolved:    { label: '해결',    variant: 'success' },
    closed:      { label: '종료',    variant: 'default' },
  };
  const { label, variant } = map[status] ?? { label: status, variant: 'default' };
  return <Badge variant={variant}>{label}</Badge>;
}

// -----------------------------------------------------------------------
// Sparkline SVG (순수 SVG, 외부 라이브러리 없음)
// -----------------------------------------------------------------------
function Sparkline({
  data,
  color = '#129B8E',
}: {
  data: number[];
  color?: string;
}) {
  if (!data || data.length < 2) {
    return <div className="h-[30px] w-full" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = 100 / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${30 - ((v - min) / range) * 28}`)
    .join(' ');

  const areaPoints = [
    `0,30`,
    ...data.map((v, i) => `${i * step},${30 - ((v - min) / range) * 28}`),
    `100,30`,
  ].join(' ');

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="w-full h-[30px]"
      aria-hidden="true"
    >
      <polygon
        points={areaPoints}
        fill={color}
        fillOpacity={0.10}
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// -----------------------------------------------------------------------
// 4-메트릭 Sparkline 스트립
// -----------------------------------------------------------------------
interface MetricColumn {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number | null;
  sparkData?: number[];
}

function SparklineStrip({ metrics }: { metrics: MetricColumn[] }) {
  return (
    <Card className="p-0">
      <div className="grid grid-cols-4 divide-x divide-border-default">
        {metrics.map((m, idx) => {
          const deltaPositive = (m.delta ?? 0) > 0;
          const deltaZero = m.delta === null || m.delta === undefined || m.delta === 0;
          return (
            <div key={idx} className="px-5 pt-4 pb-3 flex flex-col gap-1">
              <span
                className="text-text-secondary leading-none"
                style={{ fontSize: '11.5px' }}
              >
                {m.label}
              </span>
              <div className="flex items-baseline gap-1">
                <span
                  className="font-bold tabular-nums text-text-primary leading-none"
                  style={{ fontSize: '28px' }}
                >
                  {m.value}
                </span>
                {m.unit && (
                  <span className="text-xs text-text-secondary">{m.unit}</span>
                )}
              </div>
              {!deltaZero && (
                <span
                  className={cn(
                    'text-xs font-medium',
                    deltaPositive ? 'text-brand' : 'text-error-text',
                  )}
                >
                  {deltaPositive ? '+' : ''}{m.delta}
                </span>
              )}
              <div className="mt-1">
                <Sparkline data={m.sparkData ?? []} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// SLA 도넛 (순수 SVG conic-gradient via CSS)
// -----------------------------------------------------------------------
function SlaDoughnut({
  rate,
  breachCount,
  okCount,
}: {
  rate: number;
  breachCount: number;
  okCount: number;
}) {
  const pct = Math.round(rate * 100);
  const angle = pct * 3.6; // 0~360deg

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium text-text-primary mb-3">SLA 준수율</h2>
      <div className="flex items-center gap-5">
        {/* 도넛 */}
        <div className="relative shrink-0 w-[72px] h-[72px]">
          <div
            className="w-full h-full rounded-full"
            style={{
              background: `conic-gradient(#129B8E 0deg ${angle}deg, #E6F1EF ${angle}deg 360deg)`,
            }}
          />
          {/* 중앙 hole */}
          <div className="absolute inset-[12px] rounded-full bg-surface flex items-center justify-center">
            <span className="text-sm font-bold text-text-primary tabular-nums">
              {pct}%
            </span>
          </div>
        </div>
        {/* 통계 */}
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success shrink-0" />
            <span className="text-text-secondary">준수</span>
            <span className="ml-auto font-semibold text-text-primary tabular-nums">
              {okCount}건
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-error shrink-0" />
            <span className="text-text-secondary">위반</span>
            <span className="ml-auto font-semibold text-error-text tabular-nums">
              {breachCount}건
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// 최근 티켓 카드
// -----------------------------------------------------------------------
function RecentTicketsCard({
  tickets,
  isLoading,
  tenantSlug,
}: {
  tickets: Ticket[];
  isLoading: boolean;
  tenantSlug: string;
}) {
  const router = useRouter();

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-primary">최근 티켓</h2>
        <button
          type="button"
          className="text-xs text-brand hover:underline"
          onClick={() => router.push(`/${tenantSlug}/tickets`)}
        >
          전체 보기
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-text-secondary text-center py-6">
          티켓이 없습니다.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border-subtle">
          {tickets.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              {/* 틸 점 */}
              <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
              {/* 본문 */}
              <div className="flex-1 min-w-0">
                <p
                  className="truncate text-text-primary font-medium leading-tight"
                  style={{ fontSize: '13.5px' }}
                >
                  {t.title}
                </p>
                <p
                  className="text-text-secondary truncate leading-tight"
                  style={{ fontSize: '11.5px' }}
                >
                  {t.customer_name ? `${t.customer_name} · ` : ''}
                  {t.ticket_number ?? '-'}
                </p>
              </div>
              {/* 배지 */}
              <div className="flex items-center gap-1.5 shrink-0">
                <PriorityBadge priority={t.priority} />
                <StatusBadge status={t.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// 공통 KPI 카드 (모든 역할 대시보드에서 사용 — shadow-md 포함)
// -----------------------------------------------------------------------
function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: 'warning' | 'error' | 'success' | 'default';
}) {
  const accentClass = {
    warning: 'text-warning-text',
    error:   'text-error-text',
    success: 'text-success-text',
    default: 'text-brand',
  }[accent ?? 'default'];

  return (
    <div className="rounded-lg border border-border-default bg-surface shadow-[var(--shadow-card)] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <Icon size={15} className={accentClass} />
      </div>
      <div>
        <p className="text-2xl font-semibold text-text-primary">{value}</p>
        {sub && <p className="text-xs text-text-secondary mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 엔지니어 대시보드 (개인 워크스페이스)
// -----------------------------------------------------------------------
function EngineerDashboard({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();

  const { data: report, isLoading } = useQuery<ReportSummary>({
    queryKey: ['report', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports/summary`).then((r) => r.data),
  });

  const { data: myTickets, isLoading: ticketsLoading } = useQuery<{ items: Ticket[]; total: number }>({
    queryKey: ['my-tickets', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets`, { params: { page_size: 10, status: 'open' } })
        .then((r) => r.data),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">내 워크스페이스</h1>
          <p className="text-sm text-text-secondary mt-0.5">오늘도 수고하세요.</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/tickets/new`)}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-[#1A1A1A] bg-brand hover:bg-brand-hover transition-colors"
        >
          <Plus size={14} />
          새 티켓
        </button>
      </div>

      {/* KPI 카드 */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <KpiCard
            label="진행 중 티켓"
            value={report?.by_status?.find((s) => s.status === 'open')?.count ?? 0}
            sub="미해결"
            icon={LifeBuoy}
          />
          <KpiCard
            label="SLA 위험"
            value={report?.sla_breach_count ?? 0}
            sub="30분 이내 기한"
            icon={AlertTriangle}
            accent="error"
          />
          <KpiCard
            label="이번달 CSAT"
            value={report?.csat_summary?.avg_score ? `★${report.csat_summary.avg_score.toFixed(1)}` : '-'}
            sub="고객 만족도"
            icon={Star}
            accent="success"
          />
        </div>
      )}

      {/* 담당 티켓 목록 */}
      <div>
        <h2 className="text-sm font-medium text-text-primary mb-3">담당 티켓</h2>
        {ticketsLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <Card>
            <table className="w-full text-sm">
              <thead className="bg-surface-elevated">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">번호</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">제목</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">생성일</th>
                </tr>
              </thead>
              <tbody>
                {(myTickets?.items ?? []).slice(0, 8).map((t) => (
                  <tr key={t.id} className="border-t border-border-subtle">
                    <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">
                      {t.ticket_number ?? '-'}
                    </td>
                    <td className="px-4 py-2.5 text-text-primary truncate max-w-xs">{t.title}</td>
                    <td className="px-4 py-2.5 text-xs text-text-secondary">
                      {formatRelativeTime(t.created_at)}
                    </td>
                  </tr>
                ))}
                {(myTickets?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-text-secondary">
                      담당 티켓이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Active Timer 위젯
// -----------------------------------------------------------------------
interface ActiveTimerItem {
  user_id: string;
  user_name: string | null;
  ticket_id: string;
  ticket_number: string | null;
  ticket_title: string | null;
  started_at: string;
  elapsed_seconds: number;
}

function useElapsedFromSeconds(seconds: number, startedAt: string): string {
  const [elapsed, setElapsed] = React.useState(seconds);
  React.useEffect(() => {
    const base = Date.now() - new Date(startedAt).getTime();
    setElapsed(Math.floor(base / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ActiveTimerRow({ item }: { item: ActiveTimerItem }) {
  const elapsed = useElapsedFromSeconds(item.elapsed_seconds, item.started_at);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-0">
      <div className="w-7 h-7 rounded-full bg-brand-subtle flex items-center justify-center shrink-0">
        <Play size={11} className="text-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">
          {item.user_name ?? '알 수 없음'}
        </p>
        <p className="text-xs text-text-secondary truncate">
          {item.ticket_number ? `${item.ticket_number} · ` : ''}{item.ticket_title ?? '-'}
        </p>
      </div>
      <span className="font-mono text-sm font-semibold text-brand tabular-nums shrink-0">
        {elapsed}
      </span>
    </div>
  );
}

function ActiveTimersWidget({ tenantSlug }: { tenantSlug: string }) {
  const { data: items = [], isLoading } = useQuery<ActiveTimerItem[]>({
    queryKey: ['active-timers', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/work-logs/active-timers`).then((r) => r.data),
    refetchInterval: 15000,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <Clock size={13} className="text-brand" />
          현재 작업 중
        </h2>
        <span className="text-xs text-text-secondary bg-surface-elevated rounded-full px-2 py-0.5">
          {items.length}명
        </span>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-secondary text-center py-4">
          현재 타이머를 실행 중인 팀원이 없습니다.
        </p>
      ) : (
        <div className="divide-y divide-border-subtle">
          {items.map((item) => (
            <ActiveTimerRow key={item.user_id} item={item} />
          ))}
        </div>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// 주간 공수 위젯 (시안 enrich — 아바타+이름+건수·시간+brand 진행바+유상/무상)
// -----------------------------------------------------------------------
interface WeeklyUserHours {
  user_id: string;
  user_name: string | null;
  total_hours: number;
  billable_hours: number;
  log_count: number;
}

function WeeklyHoursWidget({ tenantSlug }: { tenantSlug: string }) {
  const { data: rows = [], isLoading } = useQuery<WeeklyUserHours[]>({
    queryKey: ['weekly-hours', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/work-logs/weekly-by-user`).then((r) => r.data),
    refetchInterval: 60000,
  });

  const maxHours = Math.max(...rows.map((r) => r.total_hours), 0.1);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <BarChart2 size={13} className="text-brand" />
          이번 주 공수
        </h2>
        <span className="text-xs text-text-secondary">
          {new Date().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 기준
        </span>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary text-center py-4">
          이번 주 공수 기록이 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const billableRatio = row.total_hours > 0
              ? Math.round((row.billable_hours / row.total_hours) * 100)
              : 0;
            const nonBillable = Math.round((row.total_hours - row.billable_hours) * 100) / 100;

            return (
              <div key={row.user_id}>
                <div className="flex items-center gap-2 mb-1">
                  {/* 아바타 */}
                  <div className="w-6 h-6 rounded-full bg-brand-subtle flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-semibold text-brand">
                      {(row.user_name ?? '?').charAt(0)}
                    </span>
                  </div>
                  <span className="text-xs text-text-primary font-medium flex-1 truncate">
                    {row.user_name ?? '알 수 없음'}
                  </span>
                  <span className="text-xs text-text-secondary">{row.log_count}건</span>
                  <span className="text-xs font-semibold text-text-primary tabular-nums">
                    {row.total_hours}h
                  </span>
                </div>
                {/* 진행바 — brand 그라디언트 */}
                <div className="h-1.5 w-full rounded-full bg-surface-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(row.total_hours / maxHours) * 100}%`,
                      background: 'linear-gradient(90deg, #129B8E 0%, #16A597 100%)',
                    }}
                  />
                </div>
                {row.billable_hours > 0 && (
                  <p className="text-[10px] text-text-disabled mt-0.5">
                    유상 {row.billable_hours}h · 무상 {nonBillable}h · 유상비율 {billableRatio}%
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// 팀장/관리자 대시보드 — 시안 레이아웃
// -----------------------------------------------------------------------
function TeamDashboard({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();

  const { data: report, isLoading } = useQuery<ReportSummary>({
    queryKey: ['report', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports/summary`).then((r) => r.data),
  });

  const { data: recentTickets, isLoading: ticketsLoading } = useQuery<{ items: Ticket[]; total: number }>({
    queryKey: ['recent-tickets', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets`, { params: { page_size: 8 } }).then((r) => r.data),
  });

  // sparkline 데이터 계산
  const monthlyData = report?.monthly_tickets ?? [];
  const sparkCounts = monthlyData.map((m) => m.count);
  const lastTwo = sparkCounts.slice(-2);
  const ticketDelta = lastTwo.length === 2 ? lastTwo[1] - lastTwo[0] : null;

  const openCount = report?.by_status?.find((s) => s.status === 'open')?.count ?? 0;
  const slaBreaches = report?.sla_breach_count ?? 0;
  const slaRate = report?.sla_compliance_rate ?? 0;
  const totalByStatus = report?.by_status?.reduce((acc, s) => acc + s.count, 0) ?? 0;
  // 백엔드 compliance_rate = 1 - breach/total 와 일치하도록 정확 산정 (근사 round 금지)
  const slaOkCount = Math.max(0, totalByStatus - slaBreaches);

  const metrics: MetricColumn[] = [
    {
      label: '활성 티켓',
      value: openCount,
      unit: '건',
      sparkData: sparkCounts,
      delta: ticketDelta,
    },
    {
      label: '이번달 처리',
      value: report?.monthly_resolved ?? 0,
      unit: '건',
      sparkData: report?.csat_summary?.monthly_trend?.map((m) => m.count) ?? [],
      delta: null,
    },
    {
      label: 'SLA 준수율',
      value: `${Math.round(slaRate * 100)}`,
      unit: '%',
      sparkData: [],
      delta: null,
    },
    {
      label: 'CSAT 평균',
      value: report?.csat_summary?.avg_score?.toFixed(1) ?? '-',
      unit: '점',
      sparkData: report?.csat_summary?.monthly_trend?.map((m) => m.avg_score) ?? [],
      delta: null,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">팀 대시보드</h1>
          <p className="text-sm text-text-secondary mt-0.5">팀 전체 현황을 확인하세요.</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/tickets/new`)}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-[#1A1A1A] bg-brand hover:bg-brand-hover transition-colors"
        >
          <Plus size={14} />
          새 티켓
        </button>
      </div>

      {/* 4-메트릭 sparkline 스트립 */}
      {isLoading ? (
        <Skeleton className="h-[100px] w-full rounded-lg" />
      ) : (
        <SparklineStrip metrics={metrics} />
      )}

      {/* 2컬럼 그리드 — 1.55fr / 1fr */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
        {/* 좌: 최근 티켓 */}
        {ticketsLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <RecentTicketsCard
            tickets={recentTickets?.items ?? []}
            isLoading={ticketsLoading}
            tenantSlug={tenantSlug}
          />
        )}

        {/* 우: SLA 도넛 + 공수 위젯 */}
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <Skeleton className="h-[120px] w-full rounded-lg" />
          ) : (
            <SlaDoughnut
              rate={slaRate}
              breachCount={slaBreaches}
              okCount={slaOkCount}
            />
          )}
          <ActiveTimersWidget tenantSlug={tenantSlug} />
          <WeeklyHoursWidget tenantSlug={tenantSlug} />
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 영업(sales) 대시보드
// -----------------------------------------------------------------------
function SalesDashboard({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/customers`).then((r) => r.data),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">영업 현황</h1>
          <p className="text-sm text-text-secondary mt-0.5">고객 및 계약 파이프라인을 확인하세요.</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/tickets/new`)}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-[#1A1A1A] bg-brand hover:bg-brand-hover transition-colors"
        >
          <Plus size={14} />
          새 티켓
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <KpiCard
          label="전체 고객"
          value={isLoading ? '-' : (customers?.total ?? 0)}
          icon={Users}
        />
        <KpiCard
          label="활성 계약"
          value="-"
          sub="계약 관리에서 확인"
          icon={TrendingUp}
          accent="success"
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// C-level 대시보드
// -----------------------------------------------------------------------
function CLevelDashboard({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();

  const { data: report, isLoading } = useQuery<ReportSummary>({
    queryKey: ['report', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports/summary`).then((r) => r.data),
  });

  const sparkCounts = (report?.monthly_tickets ?? []).map((m) => m.count);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">경영 현황</h1>
          <p className="text-sm text-text-secondary mt-0.5">운영 지표 요약입니다.</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/tickets/new`)}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-[#1A1A1A] bg-brand hover:bg-brand-hover transition-colors"
        >
          <Plus size={14} />
          새 티켓
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <>
          {/* 4-메트릭 sparkline 스트립 */}
          <SparklineStrip
            metrics={[
              {
                label: 'SLA 준수율',
                value: `${Math.round((report?.sla_compliance_rate ?? 0) * 100)}`,
                unit: '%',
                sparkData: [],
                delta: null,
              },
              {
                label: '이번달 처리',
                value: report?.monthly_resolved ?? 0,
                unit: '건',
                sparkData: sparkCounts,
                delta: null,
              },
              {
                label: 'CSAT 평균',
                value: report?.csat_summary?.avg_score?.toFixed(1) ?? '-',
                unit: '점',
                sparkData: report?.csat_summary?.monthly_trend?.map((m) => m.avg_score) ?? [],
                delta: null,
              },
              {
                label: 'MTTR',
                value: report?.mttr_minutes != null
                  ? `${Math.round(report.mttr_minutes / 60)}`
                  : '-',
                unit: 'h',
                sparkData: [],
                delta: null,
              },
            ]}
          />
          <div className="grid grid-cols-3 gap-4">
            <KpiCard
              label="SLA 준수율"
              value={`${Math.round((report?.sla_compliance_rate ?? 0) * 100)}%`}
              icon={CheckCircle2}
              accent="success"
            />
            <KpiCard
              label="이번달 처리"
              value={report?.monthly_resolved ?? 0}
              sub="완료 티켓"
              icon={BarChart2}
            />
            <KpiCard
              label="CSAT 평균"
              value={report?.csat_summary?.avg_score ? `★${report.csat_summary.avg_score.toFixed(1)}` : '-'}
              icon={Star}
              accent="success"
            />
          </div>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 홈 페이지 — 역할별 분기
// -----------------------------------------------------------------------
export default function HomePage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const { user } = useAuth();
  const role = user?.role as UserRole | undefined;

  if (!tenantSlug) return null;

  if (isCLevel(role)) return <CLevelDashboard tenantSlug={tenantSlug} />;
  if (isSales(role)) return <SalesDashboard tenantSlug={tenantSlug} />;
  if (isTeamLeadOrAbove(role)) return <TeamDashboard tenantSlug={tenantSlug} />;
  return <EngineerDashboard tenantSlug={tenantSlug} />;
}
