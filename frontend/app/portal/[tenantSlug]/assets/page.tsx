'use client';

/**
 * portal/[tenantSlug]/assets/page.tsx — 포털 자산 조회
 *
 * warranty_end 기준:
 * - 지난 경우 → "만료됨" 빨간 배지
 * - 30일 이내 → "만료 임박" 주황 배지
 * - 나머지 → D-day 텍스트
 */

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------
interface PortalAsset {
  id: string;
  asset_tag: string;
  model: string;
  asset_type: 'hw' | 'sw' | string;
  warranty_end: string | null;
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

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function AssetCardSkeleton() {
  return (
    <div className="bg-surface rounded-xl border border-border-default p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-5 w-14" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function PortalAssetsPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  // 모든 hook은 조건부 return 이전에 선언
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const { data: assets, isLoading: assetsLoading } = useQuery<PortalAsset[]>({
    queryKey: ['portal-assets', tenantSlug],
    queryFn: async () => {
      const response = await api.get<PortalAsset[]>(
        `/portal/${tenantSlug}/assets`,
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
          <AssetCardSkeleton key={i} />
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
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-text-primary">내 자산</h1>

      {assetsLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <AssetCardSkeleton key={i} />
          ))}
        </div>
      ) : !assets || assets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
            <Package size={22} className="text-text-secondary" />
          </div>
          <p className="text-sm text-text-secondary">등록된 자산이 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {assets.map((asset) => {
            const days = getDaysUntil(asset.warranty_end);
            const isExpired = days !== null && days < 0;
            const isExpiringSoon = days !== null && days >= 0 && days <= 30;

            return (
              <div
                key={asset.id}
                className="bg-surface rounded-xl border border-border-default p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {asset.asset_tag}
                    </p>
                    <p className="text-sm text-text-secondary truncate">
                      {asset.model}
                    </p>
                  </div>
                  {/* 보증 만료 배지 */}
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
                  {/* 자산 유형 배지 */}
                  <Badge variant={asset.asset_type === 'hw' ? 'info' : 'default'}>
                    {asset.asset_type === 'hw' ? '하드웨어' : asset.asset_type === 'sw' ? '소프트웨어' : asset.asset_type}
                  </Badge>

                  {/* 보증 만료일 */}
                  {asset.warranty_end && (
                    <span className="text-xs text-text-secondary">
                      {isExpired
                        ? `보증 만료: ${new Date(asset.warranty_end).toLocaleDateString('ko-KR')}`
                        : days !== null
                          ? `보증 만료 D-${days}`
                          : `보증 만료: ${new Date(asset.warranty_end).toLocaleDateString('ko-KR')}`}
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
