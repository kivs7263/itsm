'use client';

/**
 * (app)/layout.tsx — 인증된 사용자 전용 AppShell
 *
 * - useAuth()로 인증 확인, 미인증 시 /{slug}/login 리다이렉트
 * - 데스크탑: Sidebar + main 영역
 * - 모바일: 하단 네비 + main 영역
 * - if (loading) return null 패턴 금지 → Spinner 반환 (CLS 방지)
 * - Admin UI hide ≠ URL 보호 — role 체크는 각 page.tsx에서 별도 수행
 */

import React, { Suspense, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Sidebar } from '@/components/layout/Sidebar';
import { BusinessContextBar } from '@/components/layout/BusinessContextBar';
import { useSlug } from '@/lib/slug';
import { GlobalTimerBar } from '@/components/tickets/GlobalTimerBar';

// -----------------------------------------------------------------------
// 인라인 스피너 (외부 컴포넌트 의존 최소화)
// -----------------------------------------------------------------------
function Spinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-accent" style={{ borderTopColor: '#F5C000' }} />
    </div>
  );
}

// -----------------------------------------------------------------------
// 모바일 하단 네비
// -----------------------------------------------------------------------
import {
  LifeBuoy,
  Users,
  BookOpen,
  RefreshCw,
  Bell,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const MOBILE_NAV = [
  { label: '티켓',       href: '/tickets',          icon: LifeBuoy  },
  { label: '고객',       href: '/customers',        icon: Users     },
  { label: '지식베이스', href: '/kb',               icon: BookOpen  },
  { label: '반복 장애',  href: '/recurring-alerts', icon: RefreshCw },
] as const;

function BottomNav() {
  const slug = useSlug();
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-default bg-surface md:hidden"
      aria-label="모바일 하단 네비게이션"
    >
      <div className="flex items-center justify-around px-2 py-1.5 pb-safe">
        {MOBILE_NAV.map(({ label, href, icon: Icon }) => {
          const fullHref = slug(href);
          const isActive = pathname?.startsWith(fullHref);
          return (
            <Link
              key={href}
              href={fullHref}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md',
                'text-[10px] transition-colors duration-fast',
                isActive ? 'text-[#F5C000]' : 'text-text-secondary',
              )}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// -----------------------------------------------------------------------
// 알림 벨 헤더 (데스크탑용)
// -----------------------------------------------------------------------
function NotificationBell({ tenantSlug }: { tenantSlug: string }) {
  const { data } = useQuery<{ total: number }>({
    queryKey: ['notification-count', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/notifications`, { params: { page_size: 1 } }).then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const total = data?.total ?? 0;

  return (
    <Link
      href={`/${tenantSlug}/notifications`}
      className="relative flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors duration-fast"
      title="알림"
    >
      <Bell size={16} />
      {total > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error text-[10px] font-semibold text-white px-1">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  );
}

// -----------------------------------------------------------------------
// AppLayoutInner — 인증 체크 포함 실제 레이아웃
// -----------------------------------------------------------------------
interface AppLayoutProps {
  children: React.ReactNode;
}

function AppLayoutInner({ children }: AppLayoutProps) {
  const router = useRouter();
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string | undefined;
  const { user, tenants, isLoading, isAuthenticated } = useAuth();

  // 미인증 리다이렉트
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(tenantSlug ? `/${tenantSlug}/login` : '/login');
    }
  }, [isLoading, isAuthenticated, router, tenantSlug]);

  // 가짜 slug 보호 — URL slug가 사용자 테넌트에 없으면 실제 slug로 교정
  useEffect(() => {
    if (isLoading || !isAuthenticated || !tenantSlug || tenants.length === 0) return;
    const known = tenants.some((t) => t.slug === tenantSlug);
    if (!known) {
      router.replace(`/${tenants[0].slug}/tickets`);
    }
  }, [isLoading, isAuthenticated, tenantSlug, tenants, router]);

  // 로딩 중 스피너 (if loading return null 금지)
  if (isLoading) {
    return <Spinner />;
  }

  // 미인증 상태에서 리다이렉트 중 — 스피너 유지
  if (!isAuthenticated) {
    return <Spinner />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* 사이드바 — 데스크탑만 (md 이상) */}
      <div className="hidden md:flex relative">
        <Sidebar />
      </div>

      {/* 메인 콘텐츠 */}
      <main
        id="main-content"
        className="flex-1 flex flex-col min-w-0 overflow-hidden pb-14 md:pb-0"
        tabIndex={-1}
      >
        {/* Skip Link */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-accent focus:text-text-inverse focus:rounded"
        >
          메인 콘텐츠로 건너뛰기
        </a>

        {/* 사업카드 컨텍스트 바 (SA_BACKEND_URL 미설정 시 숨김) */}
        {tenantSlug && <BusinessContextBar tenantSlug={tenantSlug} />}

        {/* 미니 헤더 — 알림 벨 (데스크탑, md 이상) */}
        {tenantSlug && (
          <div className="hidden md:flex items-center justify-end px-4 py-1.5 border-b border-border-subtle bg-surface shrink-0">
            <NotificationBell tenantSlug={tenantSlug} />
          </div>
        )}

        {/* 페이지 콘텐츠 — 자체 스크롤 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </main>

      {/* 글로벌 타이머 바 — 타이머 실행 중일 때만 표시 */}
      {tenantSlug && <GlobalTimerBar tenantSlug={tenantSlug} />}

      {/* 하단 네비게이션 — 모바일만 */}
      <BottomNav />
    </div>
  );
}

// -----------------------------------------------------------------------
// AppLayout — Suspense 래핑 (useSearchParams 사용 하위 컴포넌트 대비)
// -----------------------------------------------------------------------
export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <AppLayoutInner>{children}</AppLayoutInner>
    </Suspense>
  );
}
