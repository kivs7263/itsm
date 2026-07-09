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

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Sidebar } from '@/components/layout/Sidebar';
import { BusinessContextBar } from '@/components/layout/BusinessContextBar';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { useSlug } from '@/lib/slug';
import { GlobalTimerBar } from '@/components/tickets/GlobalTimerBar';
import { OnboardingWizard, useOnboarding } from '@/components/onboarding/OnboardingWizard';
import { Topbar, UserMenu } from '@total/ui-shell';
import { useLocale } from '@/lib/locale';
import { getInitials } from '@/lib/utils';

// -----------------------------------------------------------------------
// 인라인 스피너 (외부 컴포넌트 의존 최소화)
// -----------------------------------------------------------------------
function Spinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-accent" style={{ borderTopColor: '#129B8E' }} />
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
  Settings,
  LogOut,
  Languages,
  MoreHorizontal,
  X,
  BarChart2,
  Home as HomeIcon,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { InboxUnreadCountResponse } from '@/lib/types';

// RA-U5: 홈 탭 추가 — 모바일에서 더보기 시트에 묻혀 있던 대시보드 진입점을 1탭으로 승격
const MOBILE_NAV = [
  { label: '홈',         href: '/home',             icon: HomeIcon  },
  { label: '티켓',       href: '/tickets',          icon: LifeBuoy  },
  { label: '고객',       href: '/customers',        icon: Users     },
  { label: '지식베이스', href: '/kb',               icon: BookOpen  },
  { label: '반복 감지',  href: '/problems?tab=recurring', icon: RefreshCw },
] as const;

// 경로 세그먼트 → breadcrumb 제목 (ALVEO-SHELL-3)
const SEG_LABELS: Record<string, string> = {
  tickets: '티켓', queue: '티켓 풀', customers: '고객', kb: '지식베이스',
  'recurring-alerts': '반복 장애', reports: '리포트', settings: '설정',
  // ITSM-NAV-A(2026-07-05): Sidebar.tsx·CommandPalette.tsx 라벨 변경과 동기화
  worklog: '작업 기록', 'work-logs': '작업 기록', assets: '자산', cmdb: 'CMDB',
  'change-requests': '변경', contracts: '계약', notifications: '알림',
  home: '대시보드', sla: 'SLA', problems: '문제 관리', inventory: '인프라',
  automation: '자동화', 'service-catalog': '서비스 카탈로그',
};

// -----------------------------------------------------------------------
// MobileMoreSheet — 모바일 더보기 바텀시트 (CA-6: 로그아웃 유일 모바일 진입점)
// Topbar UserMenu는 hidden md:block — 모바일에서 도달 불가이므로 여기서 제공.
// -----------------------------------------------------------------------
// RA-U5: '홈'은 MOBILE_NAV로 승격 이동 — 더보기 시트 중복 제거
const MOBILE_MORE_LINKS = [
  { label: '알림',    href: '/notifications', icon: Bell       },
  { label: '리포트',  href: '/reports',       icon: BarChart2  },
  { label: '설정',    href: '/settings',      icon: Settings   },
] as const;

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
  slug: (href: string) => string;
  logout: () => void;
}

function MobileMoreSheet({ open, onClose, slug, logout }: MobileMoreSheetProps) {
  const pathname = usePathname();
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
          style={{ background: 'rgba(14,14,12,0.45)' }}
        />
        <Dialog.Content
          className={cn(
            'fixed bottom-0 inset-x-0 z-50',
            'bg-surface rounded-t-2xl border-t border-border-default',
            'pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4 px-4',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
            'duration-200',
          )}
          aria-label="더보기 메뉴"
        >
          {/* 드래그 핸들 */}
          <div className="flex justify-center mb-4">
            <div className="w-10 h-1 rounded-full bg-border-default" />
          </div>
          {/* 닫기 버튼 */}
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute top-4 right-4 p-1.5 rounded-md hover:bg-surface-hover text-text-secondary transition-colors"
              aria-label="닫기"
            >
              <X size={18} />
            </button>
          </Dialog.Close>
          <Dialog.Title className="text-sm font-semibold text-text-primary mb-3">
            더보기
          </Dialog.Title>
          {/* 링크 목록 */}
          <div className="flex flex-col gap-1">
            {MOBILE_MORE_LINKS.map(({ label, href, icon: Icon }) => {
              const fullHref = slug(href);
              const isActive = pathname?.startsWith(fullHref);
              return (
                <Link
                  key={href}
                  href={fullHref}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors',
                    isActive
                      ? 'bg-surface-raised text-[#129B8E]'
                      : 'hover:bg-surface-hover text-text-secondary',
                  )}
                >
                  <Icon size={18} />
                  <span className="text-sm">{label}</span>
                </Link>
              );
            })}
          </div>
          {/* 로그아웃 — 모바일 유일 진입점 */}
          <div className="mt-3 border-t border-border-default pt-3">
            <button
              type="button"
              onClick={() => { onClose(); logout(); }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl',
                'hover:bg-error/10 active:bg-error/10 transition-colors',
                'text-sm font-medium text-error',
              )}
            >
              <LogOut size={18} />
              로그아웃
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BottomNav() {
  const slug = useSlug();
  const pathname = usePathname();
  const { logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* RA-U5: 티켓 생성 FAB — 현장 엔지니어 모바일 원터치 생성 진입점.
          기존 fixed 요소(BottomNav z-40, MobileMoreSheet/BulkActionBar z-50)와 겹치지 않게
          bottom-nav 바로 위(bottom-16)·z-40으로 배치. /tickets?new=1 → CreateTicketModal 자동 오픈. */}
      <Link
        href={`${slug('/tickets')}?new=1`}
        className={cn(
          'fixed right-4 bottom-16 z-40 md:hidden',
          'flex items-center justify-center h-12 w-12 rounded-full',
          'bg-[#129B8E] text-white shadow-lg',
          'active:scale-95 transition-transform duration-fast',
        )}
        aria-label="새 티켓 생성"
        title="새 티켓 생성"
      >
        <Plus size={22} />
      </Link>

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
                  isActive ? 'text-[#129B8E]' : 'text-text-secondary',
                )}
              >
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
          {/* 더보기 — 설정·리포트·알림·로그아웃 접근 (CA-6) */}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md',
              'text-[10px] transition-colors duration-fast text-text-secondary',
            )}
            aria-label="더보기"
          >
            <MoreHorizontal size={18} />
            <span>더보기</span>
          </button>
        </div>
        <MobileMoreSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          slug={slug}
          logout={logout}
        />
      </nav>
    </>
  );
}

// -----------------------------------------------------------------------
// 알림 벨 헤더 (데스크탑용)
// — 로컬 로그 total + 통합 인박스 unread-count 합산 표시
// — 통합 호출 실패 시 로컬만 사용 (graceful fallback)
// -----------------------------------------------------------------------
function NotificationBell({ tenantSlug }: { tenantSlug: string }) {
  // 로컬 ITSM 알림 로그 (총 건수)
  const { data: localData } = useQuery<{ total: number }>({
    queryKey: ['notification-count', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/notifications`, { params: { page_size: 1 } }).then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // 통합 인박스 미읽음 수 (graceful: 실패 시 0)
  const { data: inboxData } = useQuery<InboxUnreadCountResponse>({
    queryKey: ['inbox-unread-count'],
    queryFn: async () => {
      try {
        const r = await api.get<InboxUnreadCountResponse>('/notifications/unread-count');
        return r.data;
      } catch {
        return { count: 0 };
      }
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const localTotal = localData?.total ?? 0;
  const inboxUnread = inboxData?.count ?? 0;
  const total = localTotal + inboxUnread;

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
  const { user, tenants, isLoading, isAuthenticated, isRateLimited, logout } = useAuth();
  const { locale, setLocale } = useLocale();
  const pathname = usePathname();
  const isAdmin = user?.role === 'admin';
  const { needsOnboarding } = useOnboarding(tenantSlug, isAdmin);
  const [wizardDismissed, setWizardDismissed] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // breadcrumb 제목 — /{slug}/<seg> 의 seg 매핑
  const seg = pathname?.split('/')[2] ?? '';
  const screenTitle = SEG_LABELS[seg] ?? '';

  // ⌘K / Ctrl+K 전역 단축키 — 모든 hook 선언 이후, conditional return 이전
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setPaletteOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // 미인증 리다이렉트
  // 429(rate-limit)는 미인증이 아니다 — 세션 유지한 채 재시도(useAuth의 backoff)를
  // 기다린다. 여기서 로그아웃/리다이렉트 처리하면 정상 로그인 사용자가 빠른 화면
  // 전환만으로 강제 로그아웃 화면을 보게 된다 (ALVEO-V2 ITSM_gap §0).
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isRateLimited) {
      router.replace(tenantSlug ? `/${tenantSlug}/login` : '/login');
    }
  }, [isLoading, isAuthenticated, isRateLimited, router, tenantSlug]);

  // 가짜 slug 보호 — URL slug가 사용자 테넌트에 없으면 실제 slug로 교정
  useEffect(() => {
    if (isLoading || !isAuthenticated || !tenantSlug || tenants.length === 0) return;
    const known = tenants.some((t) => t.slug === tenantSlug);
    if (!known) {
      // RA-U6: 가짜 slug 교정 후 랜딩 = 사이드바 홈(/home)과 통일
      router.replace(`/${tenants[0].slug}/home`);
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

        {/* 상단 헤더 — breadcrumb + 검색 + 타이머 + 알림 + 유저메뉴 (데스크탑, ALVEO-SHELL-3) */}
        {tenantSlug && (
          <div className="hidden md:block shrink-0">
            <Topbar
              crumbs={[
                { label: 'ITSM' },
                ...(screenTitle ? [{ label: screenTitle, current: true }] : []),
              ]}
              onSearchClick={() => setPaletteOpen(true)}
              actions={<GlobalTimerBar tenantSlug={tenantSlug} />}
              notifications={<NotificationBell tenantSlug={tenantSlug} />}
              userMenu={
                <UserMenu
                  initials={getInitials(user?.name ?? '')}
                  name={user?.name ?? ''}
                  subtitle={user?.organization_name}
                  accentFrom="#16A597"
                  accentTo="#129B8E"
                  items={[
                    { key: 'settings', label: '설정', icon: <Settings size={15} />, onClick: () => router.push(`/${tenantSlug}/settings`) },
                    { key: 'lang', label: '언어', icon: <Languages size={15} />, hint: locale === 'ko' ? 'KO' : 'EN', onClick: () => setLocale(locale === 'ko' ? 'en' : 'ko') },
                    { key: 'logout', label: '로그아웃', icon: <LogOut size={15} />, danger: true, divider: true, onClick: logout },
                  ]}
                />
              }
            />
          </div>
        )}

        {/* 페이지 콘텐츠 — 자체 스크롤 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </main>

      {/* 하단 네비게이션 — 모바일만 */}
      <BottomNav />

      {/* 온보딩 위저드 — admin 첫 로그인 시 */}
      {tenantSlug && needsOnboarding && !wizardDismissed && (
        <OnboardingWizard
          tenantSlug={tenantSlug}
          onClose={() => setWizardDismissed(true)}
        />
      )}

      {/* ⌘K 커맨드 팔레트 — 전역 (z-50, 다른 fixed 요소 위) */}
      {tenantSlug && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          tenantSlug={tenantSlug}
        />
      )}
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
