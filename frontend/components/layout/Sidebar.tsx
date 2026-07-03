'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LifeBuoy,
  Users,
  BarChart2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Home,
  BookOpen,
  Settings,
  Clock,
  Boxes,
  GitPullRequest,
  Gauge,
  FileText,
  Bug,
  Workflow,
  LayoutGrid,
  Bell,
  UserCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSlug } from '@/lib/slug';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isSales, isCLevel, isAdminRole, type UserRole } from '@/lib/auth';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getInitials } from '@/lib/utils';
import { useLocale } from '@/lib/locale';
import { api } from '@/lib/api';

const STORAGE_KEY = 'itsm.sidebar.collapsed';

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? false : stored === 'true';
}

// RX-1c: assets·cmdb 2개 항목 → 단일 'inventory'(인프라)로 통합
// RX-4b: automation·serviceCatalog(신규 라우트) + notifications·users(설정 딥링크) 배선
// RX-4c: queue·recurringIssues 최상위 항목 제거 — 각각 tickets(?view=pool)·problems(?tab=recurring) 탭으로 흡수
type NavKey = 'dashboard' | 'tickets' | 'workLogs' | 'customers' | 'kb' | 'reports' | 'settings' | 'inventory' | 'changeRequests' | 'sla' | 'contracts' | 'problems' | 'automation' | 'serviceCatalog' | 'notifications' | 'users';
type NavItem = { key: NavKey; href: string; icon: React.ElementType };
// RA-U3: 섹션 그룹핑 — titleKey 없으면 무제목 섹션(홈), 있으면 t.nav.sections[titleKey] 라벨
// RX-4b: 16개 평면 항목 → 8 도메인 허브(홈/작업/서비스관리/고객/인프라/지식/관리)로 재편
type SectionKey = 'work' | 'serviceMgmt' | 'customers' | 'infra' | 'knowledge' | 'admin';
type NavSection = { titleKey?: SectionKey; items: NavItem[] };

// SHELL-7 항목 ③: 아이콘 17px 통일
// RA-U3: 13~15개 평면 나열(Miller 7±2 초과) → SSO Sidebar 패턴 참고해 섹션 그룹핑
// RX-4b: 8 도메인 허브 — 홈 / 작업(티켓·풀·작업기록) / 서비스관리(변경요청·문제·SLA·반복이슈·자동화·서비스카탈로그) /
//        고객(고객·계약) / 인프라 / 지식(KB) / 관리(리포트·설정·사용자·알림)
const ENGINEER_SECTIONS: NavSection[] = [
  {
    items: [
      { key: 'dashboard', href: '/home', icon: Home },
    ],
  },
  {
    titleKey: 'work',
    items: [
      // RX-4c: 티켓 풀(FRP-3d-A1)은 tickets 페이지 "티켓 풀" 탭(?view=pool)으로 흡수 — 최상위 항목 제거
      { key: 'tickets',  href: '/tickets',   icon: LifeBuoy },
      { key: 'workLogs', href: '/work-logs',  icon: Clock    },
    ],
  },
  {
    titleKey: 'serviceMgmt',
    items: [
      { key: 'changeRequests',  href: '/change-requests',  icon: GitPullRequest },
      // CA-P2-4: Problem Management
      // RX-4c: 반복 이슈(recurring-alerts)는 problems 페이지 "반복 감지" 탭(?tab=recurring)으로 흡수 — 최상위 항목 제거
      { key: 'problems',        href: '/problems',         icon: Bug            },
      { key: 'sla',             href: '/sla',              icon: Gauge          },
      // RX-4b: automation·serviceCatalog는 team_lead+ 전용 (아래 TEAM_LEAD_SECTIONS에서 추가)
    ],
  },
  {
    titleKey: 'customers',
    items: [
      { key: 'customers', href: '/customers', icon: Users    },
      { key: 'contracts', href: '/contracts', icon: FileText },
    ],
  },
  {
    // CA-5 → RX-1c: 운영 관리 메뉴 — assets/cmdb를 단일 "인프라" 진입점(/inventory)으로 통합
    // (탭: 자산 목록 / 구성항목(CI) / 관계맵). 기존 /assets, /cmdb 경로는 리다이렉트로 보존.
    titleKey: 'infra',
    items: [
      { key: 'inventory', href: '/inventory', icon: Boxes },
    ],
  },
  {
    titleKey: 'knowledge',
    items: [
      { key: 'kb', href: '/kb', icon: BookOpen },
    ],
  },
  {
    // RX-4b: 알림 로그/인박스(/notifications)는 전 역할 공용 페이지(관리자 전용 채널상태는 페이지 내부에서 자체 게이팅)
    titleKey: 'admin',
    items: [
      { key: 'notifications', href: '/notifications', icon: Bell },
    ],
  },
];

const TEAM_LEAD_SECTIONS: NavSection[] = [
  {
    items: [
      { key: 'dashboard', href: '/home', icon: Home },
    ],
  },
  {
    titleKey: 'work',
    items: [
      // RX-4c: 티켓 풀은 tickets 페이지 "티켓 풀" 탭(?view=pool)으로 흡수 — 최상위 항목 제거
      { key: 'tickets',  href: '/tickets',   icon: LifeBuoy },
      { key: 'workLogs', href: '/work-logs',  icon: Clock    },
    ],
  },
  {
    titleKey: 'serviceMgmt',
    items: [
      { key: 'changeRequests',  href: '/change-requests',  icon: GitPullRequest },
      { key: 'problems',        href: '/problems',         icon: Bug            },
      { key: 'sla',             href: '/sla',              icon: Gauge          },
      // RX-4c: 반복 이슈는 problems 페이지 "반복 감지" 탭(?tab=recurring)으로 흡수 — 최상위 항목 제거
      // RX-4b: 신규 라우트 배선 — 자동화 룰 관리(admin/team_lead, backend require_roles와 일치)
      { key: 'automation',      href: '/automation',       icon: Workflow       },
      { key: 'serviceCatalog',  href: '/service-catalog',  icon: LayoutGrid     },
    ],
  },
  {
    titleKey: 'customers',
    items: [
      { key: 'customers', href: '/customers', icon: Users    },
      { key: 'contracts', href: '/contracts', icon: FileText },
    ],
  },
  {
    titleKey: 'infra',
    items: [
      { key: 'inventory', href: '/inventory', icon: Boxes },
    ],
  },
  {
    titleKey: 'knowledge',
    items: [
      { key: 'kb', href: '/kb', icon: BookOpen },
    ],
  },
  {
    titleKey: 'admin',
    items: [
      { key: 'reports',       href: '/reports',       icon: BarChart2 },
      { key: 'notifications', href: '/notifications', icon: Bell      },
    ],
  },
];

const ADMIN_SECTIONS: NavSection[] = TEAM_LEAD_SECTIONS.map((section) =>
  section.titleKey === 'admin'
    ? {
        ...section,
        items: [
          { key: 'reports', href: '/reports', icon: BarChart2 },
          // settings 라우트는 admin 전용(page.tsx isAdminRole 게이트) — 딥링크로 대표 탭 직접 진입
          { key: 'settings', href: '/settings?tab=general', icon: Settings },
          { key: 'users',    href: '/settings?tab=users',   icon: UserCog  },
          { key: 'notifications', href: '/notifications', icon: Bell },
        ],
      }
    : section,
);

const SALES_SECTIONS: NavSection[] = [
  { items: [{ key: 'dashboard', href: '/home', icon: Home }] },
  { titleKey: 'customers', items: [{ key: 'customers', href: '/customers', icon: Users }] },
  { titleKey: 'admin', items: [{ key: 'reports', href: '/reports', icon: BarChart2 }] },
];

const C_LEVEL_SECTIONS: NavSection[] = [
  { items: [{ key: 'dashboard', href: '/home', icon: Home }] },
  { titleKey: 'admin', items: [{ key: 'reports', href: '/reports', icon: BarChart2 }] },
];

function getNavSections(role: UserRole | undefined): NavSection[] {
  if (isCLevel(role)) return C_LEVEL_SECTIONS;
  if (isSales(role)) return SALES_SECTIONS;
  if (isAdminRole(role)) return ADMIN_SECTIONS;
  if (isTeamLeadOrAbove(role)) return TEAM_LEAD_SECTIONS;
  return ENGINEER_SECTIONS;
}

// RX-4b: 설정 딥링크(예: /settings?tab=users)는 pathname에 쿼리스트링이 포함되지 않으므로
// 섹션 자동펼침 판정 시 경로(base path)만으로 비교 — 쿼리는 아래 renderer의 정확 하이라이트에서만 사용
function pathMatchesHref(pathname: string | null, fullHref: string): boolean {
  if (!pathname) return false;
  return pathname.startsWith(fullHref.split('?')[0]);
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slug = useSlug();
  const { user, logout } = useAuth();
  const { t } = useLocale();

  // 미배정 티켓 카운트 (RX-4c: queue 최상위 항목 제거 → tickets 항목으로 배지 이관, 엔드포인트·polling 주기 동일)
  const tenantSlug = useMemo(() => {
    if (!pathname) return null;
    const match = pathname.match(/^\/([^/]+)/);
    return match?.[1] ?? null;
  }, [pathname]);

  const { data: queueCountData } = useQuery<{ count: number }>({
    queryKey: ['queue-count', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/queue/count`).then((r) => r.data),
    enabled: !!tenantSlug,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // SHELL-7 항목 ⑤: collapsed hover float 패널 추가 (GW/SA 패턴 통일)
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (!collapsed) return;
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 150);
  }, [collapsed]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverExpanded(false);
  }, []);

  const navSections = useMemo(() => getNavSections(user?.role as UserRole), [user?.role]);

  // 아코디언(단일 오픈): 한 번에 한 섹션만 열림. 현재 라우트가 속한 섹션은 이동 시 자동 펼침(위치 상실 방지).
  const activeSectionKey = useMemo<SectionKey | null>(() => {
    for (const section of navSections) {
      if (!section.titleKey) continue;
      if (section.items.some((it) => pathMatchesHref(pathname, slug(it.href)))) return section.titleKey;
    }
    return null;
  }, [navSections, pathname, slug]);

  const [openSection, setOpenSection] = useState<SectionKey | null>(() => activeSectionKey);

  // 라우트가 다른 섹션으로 바뀌면 그 섹션을 열고 나머지는 닫음 (단일 오픈 유지)
  useEffect(() => {
    if (activeSectionKey) setOpenSection(activeSectionKey);
  }, [activeSectionKey]);

  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSection((prev) => (prev === key ? null : key));
  }, []);

  // SHELL-7: useCallback으로 변경 ([ 키 단축키 의존성용)
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // SHELL-7 항목 ⑤: [ 키 단축키 추가 (GW/SA 패턴 통일)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '[') {
        e.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCollapsed]);

  const effectivelyExpanded = !collapsed || hoverExpanded;
  const isFloating = collapsed && hoverExpanded;

  return (
    <aside
      className={cn(
        'flex h-screen flex-col',
        'transition-[width] duration-200 ease-out',
        // SHELL-7 항목 ⑤: 절대 위치(floating) 처리
        isFloating && 'absolute z-30 shadow-lg',
      )}
      // SHELL-7 항목 ①: 248px 고정 / collapsed 48px
      // 항목 ⑥: 배경 #17181C + border-right #24262B
      style={{
        width: effectivelyExpanded ? 248 : 48,
        minWidth: isFloating ? undefined : (effectivelyExpanded ? 248 : 48),
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <WorkspaceSwitcher collapsed={!effectivelyExpanded} />

      {/* RA-U3: 섹션 그룹핑 (SSO Sidebar 패턴 참고 — 무제목 섹션 + titled 섹션들) */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-5" aria-label={t.nav.dashboard}>
        {navSections.map((section, si) => {
          const sectionKey = section.titleKey;
          // 아이콘 레일(사이드바 축소) 상태에선 전 항목을 아이콘으로 노출(도달성 보장).
          // 펼침 상태에선 단일 오픈 섹션만 항목 표시.
          const sectionOpen =
            !sectionKey ||
            !effectivelyExpanded ||
            openSection === sectionKey;

          return (
          <div key={sectionKey ?? `section-${si}`}>
            {sectionKey && effectivelyExpanded && (
              <button
                type="button"
                onClick={() => toggleSection(sectionKey)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 mb-2 rounded-md focus-visible:outline-none hover:bg-white/[0.04] transition-colors"
                aria-expanded={sectionOpen}
              >
                <ChevronRight
                  size={12}
                  className={cn('shrink-0 transition-transform duration-150', sectionOpen && 'rotate-90')}
                  style={{ color: 'var(--sidebar-section-text, rgba(255,255,255,0.5))' }}
                />
                <span
                  className="text-[12px] font-semibold truncate"
                  style={{ color: 'var(--sidebar-section-text, rgba(255,255,255,0.4))' }}
                >
                  {t.nav.sections[sectionKey]}
                </span>
              </button>
            )}
            {sectionOpen && section.items.map(({ key, href, icon: Icon }) => {
              const label = t.nav[key];
              const fullHref = slug(href);
              // RX-4b: 쿼리스트링 딥링크(/settings?tab=users 등)는 정확 일치로,
              // 그 외 일반 경로는 기존 prefix 매칭 그대로 유지
              const [hrefPath, hrefQuery] = fullHref.split('?');
              const isActive = hrefQuery
                ? pathname === hrefPath && (searchParams?.toString() ?? '') === hrefQuery
                : pathname?.startsWith(fullHref);

              return (
                <Link
                  key={href}
                  href={fullHref}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-2.5 py-2',
                    'transition-colors duration-[150ms]',
                    'focus-visible:outline-none focus-visible:shadow-brand',
                    // RA-B(다크 리파인드): 화이트 오버레이 8% 단일 장치 — 좌측바 제거, pill 하나로 절제
                    isActive
                      ? 'font-semibold'
                      : 'hover:bg-white/[0.06]',
                  )}
                  style={
                    isActive
                      ? {
                          background: 'var(--sidebar-active-bg)',
                          color: 'var(--sidebar-active-text, #F5F5F5)',
                          fontSize: '14px',
                        }
                      : {
                          color: 'var(--sidebar-nav-text, rgba(255,255,255,0.6))',
                          fontSize: '14px',
                        }
                  }
                  title={!effectivelyExpanded ? label : undefined}
                >
                  {/* SHELL-7 항목 ③: 아이콘 16px */}
                  <Icon
                    size={16}
                    className={cn('shrink-0', isActive ? '' : 'text-white/40')}
                    style={isActive ? { color: 'var(--color-brand)' } : undefined}
                  />
                  {effectivelyExpanded && <span className="truncate flex-1">{label}</span>}
                  {key === 'tickets' && (queueCountData?.count ?? 0) > 0 && (
                    <span
                      className="shrink-0 flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1.5 min-w-4 h-4"
                      // RA-V1: 흰 텍스트가 배지 위에 올라가므로 base(--color-error, WCAG 4.11:1 미달)가 아닌
                      // -text 변형(--color-error-text, WCAG 4.99:1 통과) 사용
                      style={{ background: 'var(--color-error-text, #C0482F)' }}
                    >
                      {queueCountData?.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          );
        })}
      </nav>

      {/* 하단: 사용자 카드 1행 (SHELL-7 항목 ④) — D2: 언어 토글은 헤더 UserMenu로 통합 */}
      <div
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        className="p-2 flex flex-col gap-1"
      >
        {/* 1행 사용자 카드: 아바타 32px + 이름/이메일 1줄 + 로그아웃 */}
        {user && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1',
              'hover:bg-white/[0.06] cursor-default transition-colors duration-fast',
              !effectivelyExpanded && 'justify-center',
            )}
          >
            {/* 아바타 32px */}
            <div
              className="flex shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{
                width: 32,
                height: 32,
                background: 'var(--color-brand, #129B8E)',
                color: '#1A1A1A',
              }}
              title={user.name}
            >
              {getInitials(user.name)}
            </div>
            {/* 이름 + 이메일/역할 부제 1줄 */}
            {effectivelyExpanded && (
              <div className="min-w-0 flex-1">
                <p
                  className="font-medium truncate leading-none"
                  style={{ fontSize: '13px', color: '#EDEBF0' }}
                >
                  {user.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="truncate leading-none"
                    style={{ fontSize: '11px', color: '#6E6B79' }}
                  >
                    {user.email}
                  </span>
                  {user.role && (
                    <span className="shrink-0 rounded px-1 py-px text-[9px] font-medium bg-white/10 text-white/60">
                      {t.auth.role[user.role as UserRole] ?? user.role}
                    </span>
                  )}
                </div>
              </div>
            )}
            {/* 로그아웃 아이콘 */}
            <button
              type="button"
              onClick={logout}
              className={cn(
                'flex items-center justify-center p-1 rounded',
                'text-white/40 hover:text-red-400 hover:bg-red-500/10',
                'transition-colors duration-fast focus-visible:outline-none flex-shrink-0',
              )}
              title={t.auth.logout}
              aria-label={t.auth.logout}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>

      {/* collapsed 토글 — [ 키 + 버튼 (SHELL-7: GW/SA 패턴 통일) */}
      <button
        type="button"
        onClick={toggleCollapsed}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full',
          'absolute -right-3 top-7',
          'border border-white/10 bg-[#1F2025]',
          'text-white/40 hover:text-white transition-colors duration-fast',
          'focus-visible:outline-none focus-visible:shadow-brand',
          'z-10',
        )}
        aria-label={collapsed ? t.sidebar.open : t.sidebar.close}
        title="["
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
