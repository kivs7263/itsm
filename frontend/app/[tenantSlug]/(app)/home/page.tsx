'use client';

import React from 'react';
import { useParams } from 'next/navigation';
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
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ReportSummary, Ticket } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isSales, isCLevel, type UserRole } from '@/lib/auth';
import { formatRelativeTime } from '@/lib/utils';

// -----------------------------------------------------------------------
// 공통 KPI 카드
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
    default: 'text-[#F5C000]',
  }[accent ?? 'default'];

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
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
      <div>
        <h1 className="text-xl font-semibold text-text-primary">내 워크스페이스</h1>
        <p className="text-sm text-text-secondary mt-0.5">오늘도 수고하세요.</p>
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
          <div className="rounded-lg border border-border-default overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised">
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
                      {t.ticket_number ?? t.id.slice(0, 8)}
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
          </div>
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
      <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
        <Play size={11} className="text-amber-600 dark:text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">
          {item.user_name ?? '알 수 없음'}
        </p>
        <p className="text-xs text-text-secondary truncate">
          {item.ticket_number ? `${item.ticket_number} · ` : ''}{item.ticket_title ?? '-'}
        </p>
      </div>
      <span className="font-mono text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
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
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <Clock size={13} className="text-amber-500" />
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
    </div>
  );
}

// -----------------------------------------------------------------------
// 주간 공수 위젯
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
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <BarChart2 size={13} className="text-[#F5C000]" />
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
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.user_id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-text-primary font-medium">
                  {row.user_name ?? '알 수 없음'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary">{row.log_count}건</span>
                  <span className="text-xs font-semibold text-text-primary tabular-nums">
                    {row.total_hours}h
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-surface-elevated overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{ width: `${(row.total_hours / maxHours) * 100}%` }}
                />
              </div>
              {row.billable_hours > 0 && row.billable_hours < row.total_hours && (
                <p className="text-xs text-text-disabled mt-0.5">
                  유상 {row.billable_hours}h · 무상 {Math.round((row.total_hours - row.billable_hours) * 100) / 100}h
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 팀장/관리자 대시보드
// -----------------------------------------------------------------------
function TeamDashboard({ tenantSlug }: { tenantSlug: string }) {
  const { data: report, isLoading } = useQuery<ReportSummary>({
    queryKey: ['report', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports/summary`).then((r) => r.data),
  });

  const slaBreaches = report?.sla_breach_count ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">팀 대시보드</h1>
        <p className="text-sm text-text-secondary mt-0.5">팀 전체 현황을 확인하세요.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="전체 활성 티켓"
            value={report?.by_status?.find((s) => s.status === 'open')?.count ?? 0}
            icon={LifeBuoy}
          />
          <KpiCard
            label="SLA 위험"
            value={slaBreaches}
            sub={slaBreaches > 0 ? '즉시 확인 필요' : '이상 없음'}
            icon={AlertTriangle}
            accent={slaBreaches > 0 ? 'error' : 'success'}
          />
          <KpiCard
            label="이번달 처리"
            value={report?.monthly_resolved ?? 0}
            sub="완료 티켓"
            icon={CheckCircle2}
            accent="success"
          />
          <KpiCard
            label="CSAT 평균"
            value={report?.csat_summary?.avg_score ? `★${report.csat_summary.avg_score.toFixed(1)}` : '-'}
            icon={Star}
            accent="success"
          />
        </div>
      )}

      {/* 상태별 분포 */}
      {!isLoading && report?.by_status && (
        <div className="rounded-lg border border-border-default p-4">
          <h2 className="text-sm font-medium text-text-primary mb-3">상태별 현황</h2>
          <div className="flex gap-4 flex-wrap">
            {report.by_status.map((s) => (
              <div key={s.status} className="flex items-center gap-2">
                <span className="text-xs text-text-secondary capitalize">{s.status}</span>
                <span className="text-sm font-semibold text-text-primary">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 공수 위젯 */}
      <div className="grid grid-cols-2 gap-4">
        <ActiveTimersWidget tenantSlug={tenantSlug} />
        <WeeklyHoursWidget tenantSlug={tenantSlug} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 영업(sales) 대시보드
// -----------------------------------------------------------------------
function SalesDashboard({ tenantSlug }: { tenantSlug: string }) {
  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/customers`).then((r) => r.data),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">영업 현황</h1>
        <p className="text-sm text-text-secondary mt-0.5">고객 및 계약 파이프라인을 확인하세요.</p>
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
  const { data: report, isLoading } = useQuery<ReportSummary>({
    queryKey: ['report', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports/summary`).then((r) => r.data),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">경영 현황</h1>
        <p className="text-sm text-text-secondary mt-0.5">운영 지표 요약입니다.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <KpiCard
            label="SLA 준수율"
            value={report?.sla_breach_count === 0 ? '100%' : '-'}
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
