'use client';

/**
 * portal/[tenantSlug]/catalog/page.tsx — 서비스 카탈로그 그리드
 *
 * - GET /portal/{tenantSlug}/catalog → 카테고리 트리
 * - 카테고리별 offering 카드 그리드 (아이콘·이름·설명)
 * - 카드 클릭 → /portal/{tenantSlug}/catalog/{code}
 * - 로딩/빈 상태/에러 상태
 * - 401 → login 리다이렉트
 */

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, LayoutGrid, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------
interface CatalogOffering {
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  request_type: string | null;
  default_priority: string | null;
}

interface CatalogCategory {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  display_order: number;
  offerings: CatalogOffering[];
}

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-8 w-48" />
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1, 2].map((j) => (
              <Skeleton key={j} className="h-20 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// Offering 카드
// -----------------------------------------------------------------------
function OfferingCard({
  offering,
  onClick,
}: {
  offering: CatalogOffering;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl border border-border-default bg-surface p-4 text-left hover:border-border-strong hover:shadow-sm transition-all duration-fast w-full group"
    >
      {/* 아이콘 영역 */}
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg"
        style={{ background: 'rgba(18, 155, 142, 0.10)' }}
      >
        {offering.icon ? (
          <span role="img" aria-label={offering.name}>{offering.icon}</span>
        ) : (
          <LayoutGrid size={18} style={{ color: '#129B8E' }} />
        )}
      </div>

      {/* 텍스트 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary line-clamp-1">
          {offering.name}
        </p>
        {offering.description && (
          <p className="mt-0.5 text-xs text-text-secondary line-clamp-2">
            {offering.description}
          </p>
        )}
      </div>

      <ChevronRight
        size={14}
        className="mt-1 shrink-0 text-text-disabled group-hover:text-text-secondary transition-colors"
      />
    </button>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function PortalCatalogPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  // 모든 hook은 조건부 return 이전에 선언
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const {
    data: categories,
    isLoading: catalogLoading,
    isError,
  } = useQuery<CatalogCategory[]>({
    queryKey: ['portal-catalog', tenantSlug],
    queryFn: async () => {
      const res = await api.get<CatalogCategory[]>(
        `/portal/${tenantSlug}/catalog`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!user && !!tenantSlug,
    staleTime: 2 * 60 * 1000,
  });

  // 인증 로딩 중
  if (authLoading) {
    return <CatalogSkeleton />;
  }

  // 미인증 → login 리다이렉트
  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return <CatalogSkeleton />;
  }

  // 카탈로그 로딩 중
  if (catalogLoading) {
    return <CatalogSkeleton />;
  }

  // 에러
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
          <AlertCircle size={22} className="text-text-secondary" />
        </div>
        <p className="text-sm text-text-secondary">
          카탈로그를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      </div>
    );
  }

  // offering이 있는 카테고리만 표시
  const visibleCategories = (categories ?? []).filter(
    (cat) => cat.offerings.length > 0,
  );

  return (
    <div className="flex flex-col gap-8">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">서비스 요청</h1>
        <p className="mt-1 text-sm text-text-secondary">
          필요한 서비스를 선택하고 요청하세요
        </p>
      </div>

      {/* 빈 카탈로그 */}
      {visibleCategories.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
            <LayoutGrid size={22} className="text-text-disabled" />
          </div>
          <p className="text-sm text-text-secondary">
            등록된 서비스 카탈로그가 없습니다
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {visibleCategories.map((cat) => (
            <section key={cat.id} className="flex flex-col gap-4">
              {/* 카테고리 헤더 */}
              <div className="flex items-center gap-2">
                {cat.icon && (
                  <span
                    className="text-base"
                    role="img"
                    aria-label={cat.name}
                  >
                    {cat.icon}
                  </span>
                )}
                <h2 className="text-base font-semibold text-text-primary">
                  {cat.name}
                </h2>
              </div>

              {/* Offering 카드 그리드 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {cat.offerings.map((offering) => (
                  <OfferingCard
                    key={offering.code}
                    offering={offering}
                    onClick={() =>
                      router.push(
                        `/portal/${tenantSlug}/catalog/${offering.code}`,
                      )
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
