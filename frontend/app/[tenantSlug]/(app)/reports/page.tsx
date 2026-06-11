'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BarChart2, Clock, Construction, Star, MessageSquare, Users, CheckSquare } from 'lucide-react';
import { api } from '@/lib/api';
import type { ReportSummary, TicketStatus, CSATSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 상태 배지
// -----------------------------------------------------------------------
const STATUS_STYLES: Record<TicketStatus, string> = {
  open:        'bg-status-open-bg text-status-open',
  in_progress: 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400',
  pending:     'bg-status-pending-bg text-status-pending',
  resolved:    'bg-status-resolved-bg text-status-resolved',
  closed:      'bg-status-closed-bg text-status-closed',
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  open:        '열림',
  in_progress: '진행 중',
  pending:     '대기',
  resolved:    '해결됨',
  closed:      '닫힘',
};

// -----------------------------------------------------------------------
// 월별 티켓 바 (간단한 인라인 차트)
// -----------------------------------------------------------------------
function MonthlyBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex-1 bg-border-subtle rounded-sm overflow-hidden" style={{ height: 6 }}>
      <div
        className="h-full rounded-sm"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #F5C000, #f59e0b)',
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------
// CSAT KPI 카드
// -----------------------------------------------------------------------
function CsatKpiCard({
  label,
  value,
  icon,
  iconColor,
  iconBg,
  isLoading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface p-4 flex items-center gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: iconBg }}
      >
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <div>
        <p className="text-xs text-text-secondary">{label}</p>
        {isLoading ? (
          <Skeleton className="h-6 w-16 mt-1" />
        ) : (
          <p className="text-xl font-bold text-text-primary tabular-nums">{value}</p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// CSAT 점수 분포 바
// -----------------------------------------------------------------------
function ScoreBar({ star, count, max }: { star: number; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary w-6 shrink-0 flex items-center gap-0.5">
        <Star size={10} className="fill-yellow-400 text-yellow-400" />
        {star}
      </span>
      <div className="flex-1 bg-border-subtle rounded-sm overflow-hidden" style={{ height: 6 }}>
        <div
          className="h-full rounded-sm"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #F5C000, #f59e0b)',
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span className="text-xs font-medium text-text-primary w-6 text-right tabular-nums">
        {count}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------
// 리포트 대시보드 페이지
// -----------------------------------------------------------------------
export default function ReportsPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;

  const { data: report, isLoading } = useQuery<ReportSummary>({
    queryKey: ['reports-summary', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports/summary`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const { data: csat, isLoading: csatLoading } = useQuery<CSATSummary>({
    queryKey: ['csat-summary', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/csat/summary`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const monthlyTickets = report?.monthly_tickets ?? [];
  const byStatus       = report?.by_status ?? [];
  const complianceRate = report?.sla_compliance_rate ?? 0;

  const maxMonthlyCount = Math.max(...monthlyTickets.map((m) => m.count), 1);

  const scoreDistribution = csat?.score_distribution ?? {};
  const maxScoreCount = Math.max(
    ...([1, 2, 3, 4, 5].map((s) => scoreDistribution[String(s)] ?? 0)),
    1,
  );

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">리포트</h1>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {/* Coming soon 배너 */}
        <div className="flex items-center gap-3 rounded-lg border border-border-default bg-surface p-4">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'rgba(245, 192, 0, 0.12)' }}
          >
            <Construction size={18} style={{ color: '#F5C000' }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">상세 리포트는 준비 중입니다</p>
            <p className="text-xs text-text-secondary mt-0.5">
              고급 분석, 커스텀 대시보드, 엑셀 내보내기 기능이 곧 제공됩니다.
            </p>
          </div>
          <span className="ml-auto inline-flex items-center rounded-full bg-info-bg text-info-text px-2.5 py-1 text-xs font-medium">
            Coming Soon
          </span>
        </div>

        {/* 2컬럼 */}
        <div className="grid grid-cols-2 gap-6">
          {/* 월별 티켓 추세 */}
          <div className="rounded-lg border border-border-default bg-surface">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
              <BarChart2 size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">월별 티켓 생성</h2>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : monthlyTickets.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">데이터가 없습니다.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {monthlyTickets.map((m) => (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="text-xs text-text-secondary w-14 shrink-0">{m.month}</span>
                      <MonthlyBar count={m.count} max={maxMonthlyCount} />
                      <span className="text-xs font-medium text-text-primary w-8 text-right tabular-nums">
                        {m.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 상태별 분포 + SLA 준수율 */}
          <div className="flex flex-col gap-4">
            {/* 상태별 분포 */}
            <div className="rounded-lg border border-border-default bg-surface">
              <div className="px-5 py-4 border-b border-border-subtle">
                <h2 className="text-sm font-semibold text-text-primary">상태별 티켓 분포</h2>
              </div>
              <div className="p-5">
                {isLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full rounded-lg" />
                    ))}
                  </div>
                ) : byStatus.length === 0 ? (
                  <p className="text-sm text-text-secondary text-center py-4">데이터가 없습니다.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {byStatus.map(({ status, count }) => (
                      <div
                        key={status}
                        className="rounded-lg border border-border-subtle p-3 flex flex-col gap-1"
                      >
                        <span
                          className={cn(
                            'inline-flex items-center self-start rounded-full px-2 py-0.5 text-[10px] font-medium',
                            STATUS_STYLES[status as TicketStatus],
                          )}
                        >
                          {STATUS_LABELS[status as TicketStatus] ?? status}
                        </span>
                        <span className="text-2xl font-bold text-text-primary tabular-nums">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* SLA 준수율 카드 */}
            <div className="rounded-lg border border-border-default bg-surface p-5 flex items-center gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(34, 197, 94, 0.12)' }}
              >
                <Clock size={20} style={{ color: '#22c55e' }} />
              </div>
              <div>
                <p className="text-xs text-text-secondary">SLA 준수율</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-20 mt-1" />
                ) : (
                  <p className="text-3xl font-bold text-text-primary mt-0.5">
                    {complianceRate.toFixed(1)}
                    <span className="text-lg font-medium text-text-secondary ml-0.5">%</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CSAT 섹션 */}
        <div className="rounded-lg border border-border-default bg-surface">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
            <Star size={16} className="text-text-secondary" />
            <h2 className="text-sm font-semibold text-text-primary">고객 만족도 (CSAT)</h2>
          </div>
          <div className="p-5 flex flex-col gap-5">
            {/* KPI 4개 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CsatKpiCard
                label="평균 점수"
                value={
                  csat?.avg_score != null
                    ? `${csat.avg_score.toFixed(1)} / 5`
                    : '데이터 없음'
                }
                icon={<Star size={18} />}
                iconColor="#F5C000"
                iconBg="rgba(245, 192, 0, 0.12)"
                isLoading={csatLoading}
              />
              <CsatKpiCard
                label="응답률"
                value={csat != null ? `${csat.response_rate.toFixed(1)}%` : '-'}
                icon={<CheckSquare size={18} />}
                iconColor="#22c55e"
                iconBg="rgba(34, 197, 94, 0.12)"
                isLoading={csatLoading}
              />
              <CsatKpiCard
                label="총 설문 수"
                value={csat != null ? String(csat.total) : '-'}
                icon={<Users size={18} />}
                iconColor="#3b82f6"
                iconBg="rgba(59, 130, 246, 0.12)"
                isLoading={csatLoading}
              />
              <CsatKpiCard
                label="제출 수"
                value={csat != null ? String(csat.submitted) : '-'}
                icon={<MessageSquare size={18} />}
                iconColor="#8b5cf6"
                iconBg="rgba(139, 92, 246, 0.12)"
                isLoading={csatLoading}
              />
            </div>

            {/* 점수 분포 */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-text-secondary">점수 분포</p>
              {csatLoading ? (
                <div className="flex flex-col gap-2">
                  {[5, 4, 3, 2, 1].map((s) => (
                    <Skeleton key={s} className="h-4 w-full" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {[5, 4, 3, 2, 1].map((s) => (
                    <ScoreBar
                      key={s}
                      star={s}
                      count={scoreDistribution[String(s)] ?? 0}
                      max={maxScoreCount}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
