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
