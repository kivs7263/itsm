'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Contract, ContractTier } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 날짜 포맷
// -----------------------------------------------------------------------
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getDate().toString().padStart(2, '0')}`;
  } catch {
    return typeof dateStr === 'string' ? dateStr : '-';
  }
}

// -----------------------------------------------------------------------
// SLA 등급 배지
// -----------------------------------------------------------------------
const TIER_STYLES: Record<ContractTier, string> = {
  bronze:   'bg-orange-50 text-orange-700',
  silver:   'bg-neutral-100 text-neutral-600',
  gold:     'bg-yellow-50 text-yellow-700',
  platinum: 'bg-blue-50 text-blue-700',
};

const TIER_LABELS: Record<ContractTier, string> = {
  bronze:   'Bronze',
  silver:   'Silver',
  gold:     'Gold',
  platinum: 'Platinum',
};

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-text-disabled">-</span>;
  const validTier = tier as ContractTier;
  const style = TIER_STYLES[validTier];
  const label = TIER_LABELS[validTier] ?? tier;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', style ?? 'bg-neutral-100 text-neutral-600')}>
      {label}
    </span>
  );
}

// -----------------------------------------------------------------------
// 정보 행
// -----------------------------------------------------------------------
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2.5 border-b border-border-subtle last:border-0">
      <span className="text-xs text-text-disabled w-28 shrink-0 pt-0.5">{label}</span>
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
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-3">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 계약 상세 페이지
// -----------------------------------------------------------------------
export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;
  const contractId = params?.contractId as string;

  const { data: contract, isLoading, isError, error: queryError } = useQuery<Contract>({
    queryKey: ['contract-detail', tenantSlug, contractId],
    queryFn: () => api.get(`/${tenantSlug}/contracts/${contractId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!contractId,
  });

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-error-bg">
          <AlertTriangle size={22} className="text-error-text" />
        </div>
        <p className="text-sm text-text-secondary">계약 정보를 불러오지 못했습니다.</p>
        {queryError instanceof Error && (
          <p className="text-xs text-text-disabled max-w-xs text-center">{queryError.message}</p>
        )}
        <Button size="sm" variant="ghost" onClick={() => router.back()}>
          돌아가기
        </Button>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-text-secondary">계약을 찾을 수 없습니다.</p>
        <Button size="sm" variant="ghost" onClick={() => router.back()}>
          돌아가기
        </Button>
      </div>
    );
  }

  // 계약 만료 여부
  const isExpired = contract.end_date
    ? new Date(contract.end_date) < new Date()
    : false;

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/contracts`)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span>계약</span>
        </button>
        <span className="text-text-disabled">/</span>
        <h1 className="text-xl font-semibold text-text-primary truncate">
          {typeof contract.name === 'string' ? contract.name : contractId}
        </h1>
        {isExpired && (
          <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-error-bg text-error-text">
            만료됨
          </span>
        )}
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto min-h-0 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-5">
            {/* 카드 아이콘 + 타이틀 */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                style={{ background: 'rgba(18, 155, 142, 0.12)' }}
              >
                <FileText size={18} style={{ color: '#129B8E' }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {typeof contract.name === 'string' ? contract.name : '계약 상세'}
                </p>
                <p className="text-xs text-text-secondary">
                  {typeof contract.type === 'string' ? contract.type : ''}
                </p>
              </div>
            </div>

            <div className="divide-y divide-border-subtle">
              <InfoRow label="계약명">
                {typeof contract.name === 'string' ? contract.name : '-'}
              </InfoRow>
              <InfoRow label="고객">
                {typeof contract.customer_name === 'string'
                  ? contract.customer_name
                  : typeof contract.customer_id === 'string'
                    ? contract.customer_id
                    : '-'}
              </InfoRow>
              <InfoRow label="유형">
                {typeof contract.type === 'string' ? contract.type : '-'}
              </InfoRow>
              <InfoRow label="SLA 등급">
                <TierBadge tier={typeof contract.sla_grade === 'string' ? contract.sla_grade : null} />
              </InfoRow>
              <InfoRow label="시작일">{formatDate(contract.start_date)}</InfoRow>
              <InfoRow label="종료일">
                <span className={isExpired ? 'text-error-text font-medium' : undefined}>
                  {formatDate(contract.end_date)}
                  {isExpired && (
                    <span className="ml-2 text-xs text-error-text">(만료됨)</span>
                  )}
                </span>
              </InfoRow>
              <InfoRow label="금액">
                {typeof contract.amount === 'string' && contract.amount
                  ? contract.amount
                  : '-'}
              </InfoRow>
              <InfoRow label="지원 시간">
                {typeof contract.support_hours === 'string' && contract.support_hours
                  ? contract.support_hours
                  : '-'}
              </InfoRow>
              {typeof contract.memo === 'string' && contract.memo && (
                <InfoRow label="메모">
                  <span className="text-xs text-text-secondary whitespace-pre-line">
                    {contract.memo}
                  </span>
                </InfoRow>
              )}
              <InfoRow label="등록일">
                <span className="text-xs">{formatDate(contract.created_at)}</span>
              </InfoRow>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
