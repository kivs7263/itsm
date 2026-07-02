'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { Contract, ContractsResponse, ContractTier } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 날짜 포맷 유틸
// -----------------------------------------------------------------------
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getDate().toString().padStart(2, '0')}`;
  } catch {
    return dateStr;
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

function TierBadge({ tier }: { tier: ContractTier | null }) {
  if (!tier) return <span className="text-xs text-text-disabled">-</span>;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize', TIER_STYLES[tier])}>
      {tier.charAt(0).toUpperCase() + tier.slice(1)}
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
          <td className="px-4 py-3"><Skeleton className="h-4 w-36" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
        </tr>
      ))}
    </>
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
            <FileText size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">계약 없음</p>
            <p className="mt-1 text-sm text-text-secondary">등록된 계약이 없습니다.</p>
          </div>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 계약 목록 페이지
// -----------------------------------------------------------------------
export default function ContractsPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  const [search, setSearch] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<ContractsResponse>({
    queryKey: ['contracts', tenantSlug, search],
    queryFn: () =>
      api.get(`/${tenantSlug}/contracts`, {
        params: search ? { search } : undefined,
      }).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const contracts: Contract[] = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">계약</h1>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="계약 검색..."
            className="h-8 pl-8 pr-3 w-56 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">계약명</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">고객</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">유형</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">SLA 등급</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">시작일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">종료일</th>
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
            ) : contracts.length === 0 ? (
              <EmptyState />
            ) : (
              contracts.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border-subtle hover:bg-surface-hover transition-colors cursor-pointer"
                  onClick={() => router.push(`/${tenantSlug}/contracts/${c.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    {typeof c.name === 'string' ? c.name : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {typeof c.customer_name === 'string' ? c.customer_name : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {typeof c.type === 'string' ? c.type : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge tier={c.sla_grade as ContractTier} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatDate(c.start_date)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatDate(c.end_date)}
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
