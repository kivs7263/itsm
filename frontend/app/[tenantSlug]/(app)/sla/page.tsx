'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Clock, TicketIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { SlaDashboard, SlaPolicy, ContractTier } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// KPI 카드
// -----------------------------------------------------------------------
interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  isLoading?: boolean;
}

function KpiCard({ label, value, icon, color, isLoading }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border-default bg-surface p-4 flex items-start gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: color + '1A' }}
      >
        <div style={{ color }}>{icon}</div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-secondary mb-1">{label}</p>
        {isLoading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <p className="text-2xl font-bold text-text-primary">{value}</p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// SLA 정책 등급 배지
// -----------------------------------------------------------------------
const TIER_STYLES: Record<ContractTier, string> = {
  bronze:   'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  silver:   'bg-neutral-100 text-neutral-600',
  gold:     'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400',
  platinum: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
};

const TIER_LABELS: Record<ContractTier, string> = {
  bronze:   'Bronze',
  silver:   'Silver',
  gold:     'Gold',
  platinum: 'Platinum',
};

function TierBadge({ tier }: { tier: ContractTier }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', TIER_STYLES[tier])}>
      {TIER_LABELS[tier]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 준수율 게이지
// -----------------------------------------------------------------------
function ComplianceGauge({ rate }: { rate: number }) {
  const clamped = Math.max(0, Math.min(100, rate));
  const color = clamped >= 90 ? '#22c55e' : clamped >= 75 ? '#f59e0b' : '#ef4444';
  const circumference = 2 * Math.PI * 36;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle
            cx="40" cy="40" r="36"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-border-subtle"
          />
          <circle
            cx="40" cy="40" r="36"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-text-primary">{clamped.toFixed(1)}%</span>
        </div>
      </div>
      <p className="text-xs text-text-secondary">SLA 준수율</p>
    </div>
  );
}

// -----------------------------------------------------------------------
// SLA 대시보드 페이지
// -----------------------------------------------------------------------
export default function SLAPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;

  // SLA 대시보드 요약
  const { data: dashboard, isLoading: dashLoading } = useQuery<SlaDashboard>({
    queryKey: ['sla-dashboard', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/sla/dashboard`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  // SLA 정책 목록
  const { data: policies, isLoading: policiesLoading } = useQuery<SlaPolicy[]>({
    queryKey: ['sla-policies', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/sla/policies`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const policyList: SlaPolicy[] = Array.isArray(policies) ? policies : [];

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">SLA</h1>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {/* KPI 카드 4개 */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="활성 티켓"
            value={dashboard?.active_tickets ?? 0}
            icon={<TicketIcon size={20} />}
            color="#6366f1"
            isLoading={dashLoading}
          />
          <KpiCard
            label="SLA 위반"
            value={dashboard?.sla_violations ?? 0}
            icon={<AlertTriangle size={20} />}
            color="#ef4444"
            isLoading={dashLoading}
          />
          <KpiCard
            label="경고"
            value={dashboard?.sla_warnings ?? 0}
            icon={<Clock size={20} />}
            color="#f59e0b"
            isLoading={dashLoading}
          />
          <KpiCard
            label="준수율"
            value={`${(dashboard?.compliance_rate ?? 0).toFixed(1)}%`}
            icon={<CheckCircle size={20} />}
            color="#22c55e"
            isLoading={dashLoading}
          />
        </div>

        {/* SLA 정책 테이블 + 게이지 */}
        <div className="grid grid-cols-3 gap-6">
          {/* 정책 테이블 */}
          <div className="col-span-2 rounded-lg border border-border-default bg-surface">
            <div className="px-5 py-4 border-b border-border-subtle">
              <h2 className="text-sm font-semibold text-text-primary">SLA 정책</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">등급</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">응답 시간</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">해결 시간</th>
                </tr>
              </thead>
              <tbody>
                {policiesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-border-subtle">
                      <td className="px-5 py-3"><Skeleton className="h-6 w-16 rounded-full" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                    </tr>
                  ))
                ) : policyList.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-sm text-text-secondary">
                      등록된 SLA 정책이 없습니다.
                    </td>
                  </tr>
                ) : (
                  policyList.map((p) => (
                    <tr key={p.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-5 py-3">
                        <TierBadge tier={p.tier} />
                      </td>
                      <td className="px-5 py-3 text-text-primary">
                        {p.response_hours < 1
                          ? `${Math.round(p.response_hours * 60)}분`
                          : `${p.response_hours}시간`}
                      </td>
                      <td className="px-5 py-3 text-text-primary">
                        {p.resolution_hours < 24
                          ? `${p.resolution_hours}시간`
                          : `${Math.round(p.resolution_hours / 24)}일`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 준수율 게이지 */}
          <div className="rounded-lg border border-border-default bg-surface flex items-center justify-center p-6">
            {dashLoading ? (
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-24 w-24 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            ) : (
              <ComplianceGauge rate={dashboard?.compliance_rate ?? 0} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
