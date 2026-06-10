'use client';

/**
 * portal/[tenantSlug]/contracts/page.tsx — 포털 계약 조회
 *
 * end_date 기준:
 * - 30일 이내 → "만료 임박" 주황 배지
 * - 지난 경우 → "만료됨" 빨간 배지
 */

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------
interface PortalContract {
  id: string;
  name: string;
  type: 'warranty' | 'paid' | 'maintenance' | string;
  sla_grade: string | null;
  end_date: string | null;
}

// -----------------------------------------------------------------------
// D-day 계산
// -----------------------------------------------------------------------
function getDaysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  warranty: '보증',
  paid: '유료지원',
  maintenance: '유지보수',
};

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function ContractCardSkeleton() {
  return (
    <div className="bg-surface rounded-xl border border-border-default p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24 ml-auto" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function PortalContractsPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  // 모든 hook은 조건부 return 이전에 선언
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const { data: contracts, isLoading: contractsLoading } = useQuery<
    PortalContract[]
  >({
    queryKey: ['portal-contracts', tenantSlug],
    queryFn: async () => {
      const response = await api.get<PortalContract[]>(
        `/portal/${tenantSlug}/contracts`,
      );
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: !!user && !!tenantSlug,
    staleTime: 5 * 60 * 1000,
  });

  // 인증 로딩 중
  if (authLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-32" />
        {[0, 1, 2].map((i) => (
          <ContractCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // 미인증
  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-32" />
        {[0, 1, 2].map((i) => (
          <ContractCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-text-primary">내 계약</h1>

      {contractsLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <ContractCardSkeleton key={i} />
          ))}
        </div>
      ) : !contracts || contracts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
            <FileText size={22} className="text-text-secondary" />
          </div>
          <p className="text-sm text-text-secondary">등록된 계약이 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {contracts.map((contract) => {
            const days = getDaysUntil(contract.end_date);
            const isExpired = days !== null && days < 0;
            const isExpiringSoon = days !== null && days >= 0 && days <= 30;

            return (
              <div
                key={contract.id}
                className="bg-surface rounded-xl border border-border-default p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary line-clamp-2">
                    {contract.name}
                  </p>
                  {/* 만료 배지 */}
                  {isExpired ? (
                    <Badge variant="destructive" className="shrink-0">
                      만료됨
                    </Badge>
                  ) : isExpiringSoon ? (
                    <Badge variant="warning" className="shrink-0">
                      만료 임박
                    </Badge>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* 계약 유형 배지 */}
                  <Badge variant="info">
                    {CONTRACT_TYPE_LABEL[contract.type] ?? contract.type}
                  </Badge>

                  {/* SLA 등급 */}
                  {contract.sla_grade && (
                    <Badge variant="default">
                      SLA {contract.sla_grade}
                    </Badge>
                  )}

                  {/* 만료일 */}
                  {contract.end_date && (
                    <span className="ml-auto text-xs text-text-secondary">
                      {isExpired
                        ? `만료: ${new Date(contract.end_date).toLocaleDateString('ko-KR')}`
                        : days !== null
                          ? `만료 D-${days}`
                          : `만료: ${new Date(contract.end_date).toLocaleDateString('ko-KR')}`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
