'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Asset } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 날짜 포맷
// -----------------------------------------------------------------------
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return typeof dateStr === 'string' ? dateStr : '-';
  }
}

// -----------------------------------------------------------------------
// 자산 유형 한글
// -----------------------------------------------------------------------
const ASSET_TYPE_LABELS: Record<string, string> = {
  server: '서버',
  network: '네트워크',
  storage: '스토리지',
  workstation: '워크스테이션',
  laptop: '노트북',
  mobile: '모바일',
  printer: '프린터',
  other: '기타',
};

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
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 자산 상세 페이지
// -----------------------------------------------------------------------
export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;
  const assetId = params?.assetId as string;

  const { data: asset, isLoading, isError, error: queryError } = useQuery<Asset>({
    queryKey: ['asset-detail', tenantSlug, assetId],
    queryFn: () => api.get(`/${tenantSlug}/assets/${assetId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!assetId,
  });

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-error-bg">
          <AlertTriangle size={22} className="text-error-text" />
        </div>
        <p className="text-sm text-text-secondary">자산 정보를 불러오지 못했습니다.</p>
        {queryError instanceof Error && (
          <p className="text-xs text-text-disabled max-w-xs text-center">{queryError.message}</p>
        )}
        <Button size="sm" variant="ghost" onClick={() => router.back()}>
          돌아가기
        </Button>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-text-secondary">자산을 찾을 수 없습니다.</p>
        <Button size="sm" variant="ghost" onClick={() => router.back()}>
          돌아가기
        </Button>
      </div>
    );
  }

  const assetTypeLabel = typeof asset.asset_type === 'string'
    ? (ASSET_TYPE_LABELS[asset.asset_type] ?? asset.asset_type)
    : '-';

  // 보증 만료 여부
  const isWarrantyExpired = asset.warranty_end
    ? new Date(asset.warranty_end) < new Date()
    : false;

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/assets`)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span>자산</span>
        </button>
        <span className="text-text-disabled">/</span>
        <h1 className="text-xl font-semibold text-text-primary truncate">
          {typeof asset.asset_tag === 'string' ? asset.asset_tag : assetId}
        </h1>
        <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-info-bg text-info-text">
          {assetTypeLabel}
        </span>
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
                <Package size={18} style={{ color: '#129B8E' }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {typeof asset.model === 'string' ? asset.model : '자산 상세'}
                </p>
                <p className="text-xs text-text-secondary">{assetTypeLabel}</p>
              </div>
            </div>

            <div className="divide-y divide-border-subtle">
              <InfoRow label="자산 태그">
                <span className="font-mono text-xs">
                  {typeof asset.asset_tag === 'string' ? asset.asset_tag : '-'}
                </span>
              </InfoRow>
              <InfoRow label="모델">
                {typeof asset.model === 'string' ? asset.model : '-'}
              </InfoRow>
              <InfoRow label="시리얼">
                <span className="font-mono text-xs">
                  {typeof asset.serial === 'string' ? asset.serial : '-'}
                </span>
              </InfoRow>
              <InfoRow label="유형">{assetTypeLabel}</InfoRow>
              <InfoRow label="고객">
                {typeof asset.customer_name === 'string'
                  ? asset.customer_name
                  : typeof asset.customer_id === 'string'
                    ? asset.customer_id
                    : '-'}
              </InfoRow>
              <InfoRow label="설치일">
                {formatDate(asset.installed_at)}
              </InfoRow>
              <InfoRow label="보증 만료">
                <span className={isWarrantyExpired ? 'text-error-text font-medium' : undefined}>
                  {formatDate(asset.warranty_end)}
                  {isWarrantyExpired && (
                    <span className="ml-2 text-xs text-error-text">(만료됨)</span>
                  )}
                </span>
              </InfoRow>
              <InfoRow label="라이선스 만료">
                {formatDate(asset.license_end)}
              </InfoRow>
              <InfoRow label="등록일">
                <span className="text-xs">{formatDate(asset.created_at)}</span>
              </InfoRow>
              <InfoRow label="수정일">
                <span className="text-xs">{formatDate(asset.updated_at)}</span>
              </InfoRow>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
