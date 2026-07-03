'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  RefreshCw,
  Settings,
  Clock,
  Boxes,
  Network,
  GitPullRequest,
  Gauge,
  FileText,
  Bug,
  Inbox,
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

type NavKey = 'dashboard' | 'tickets' | 'workLogs' | 'customers' | 'kb' | 'recurringIssues' | 'reports' | 'settings' | 'assets' | 'cmdb' | 'changeRequests' | 'sla' | 'contracts' | 'problems' | 'queue';
type NavItem = { key: NavKey; href: string; icon: React.ElementType };
// RA-U3: 섹션 그룹핑 — titleKey 없으면 무제목 섹션(홈), 있으면 t.nav.sections[titleKey] 라벨
type SectionKey = 'operations' | 'knowledge' | 'customers' | 'infra' | 'reports' | 'settings';
type NavSection = { titleKey?: SectionKey; items: NavItem[] };

// SHELL-7 항목 ③: 아이콘 17px 통일
// RA-U3: 13~15개 평면 나열(Miller 7±2 초과) → SSO Sidebar 패턴 참고해 섹션 그룹핑
const ENGINEER_SECTIONS: NavSection[] = [
  {
    items: [
      { key: 'dashboard', href: '/home', icon: Home },
    ],
  },
  {
    titleKey: 'operations',
    items: [
      { key: 'tickets',        href: '/tickets',         icon: LifeBuoy       },
      // FRP-3d-A1: 티켓 풀 (미배정 티켓)
      { key: 'queue',          href: '/queue',            icon: Inbox          },
      { key: 'workLogs',       href: '/work-logs',        icon: Clock          },
      { key: 'sla',            href: '/sla',              icon: Gauge          },
      { key: 'changeRequests', href: '/change-requests',  icon: GitPullRequest },
      // CA-P2-4: Problem Management
      { key: 'problems',       href: '/problems',         icon: Bug            },
    ],
  },
  {
    titleKey: 'knowledge',
    items: [
      { key: 'kb',              href: '/kb',               icon: BookOpen  },
      { key: 'recurringIssues', href: '/recurring-alerts', icon: RefreshCw },
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
    // CA-5: 운영 관리 메뉴 — page.tsx 실재 확인된 라우트만 등록
    titleKey: 'infra',
    items: [
      { key: 'assets', href: '/assets', icon: Boxes   },
      { key: 'cmdb',   href: '/cmdb',   icon: Network },
    ],
  },
];

const TEAM_LEAD_SECTIONS: NavSection[] = [
  ...ENGINEER_SECTIONS,
  { titleKey: 'reports', items: [{ key: 'reports', href: '/reports', icon: BarChart2 }] },
];

const ADMIN_SECTIONS: NavSection[] = [
  ...TEAM_LEAD_SECTIONS,
  { titleKey: 'settings', items: [{ key: 'settings', href: '/settings', icon: Settings }] },
];

const SALES_SECTIONS: NavSection[] = [
  { items: [{ key: 'dashboard', href: '/home', icon: Home }] },
  { titleKey: 'customers', items: [{ key: 'customers', href: '/customers', icon: Users }] },
  { titleKey: 'reports', items: [{ key: 'reports', href: '/reports', icon: BarChart2 }] },
];

const C_LEVEL_SECTIONS: NavSection[] = [
  { items: [{ key: 'dashboard', href: '/home', icon: Home }] },
  { titleKey: 'reports', items: [{ key: 'reports', href: '/reports', icon: BarChart2 }] },
];

function getNavSections(role: UserRole | undefined): NavSection[] {
  if (isCLevel(role)) return C_LEVEL_SECTIONS;
  if (isSales(role)) return SALES_SECTIONS;
  if (isAdminRole(role)) return ADMIN_SECTIONS;
  if (isTeamLeadOrAbove(role)) return TEAM_LEAD_SECTIONS;
  return ENGINEER_SECTIONS;
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const pathname = usePathname();
  const slug = useSlug();
  const { user, logout } = useAuth();
  const { t } = useLocale();

  // 미배정 티켓 카운트 (queue 배지용)
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
      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-3" aria-label={t.nav.dashboard}>
        {navSections.map((section, si) => (
          <div key={section.titleKey ?? `section-${si}`}>
            {section.titleKey && effectivelyExpanded && (
              <p
                className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wider truncate"
                style={{ color: 'var(--sidebar-section-text, rgba(255,255,255,0.28))' }}
              >
                {t.nav.sections[section.titleKey]}
              </p>
            )}
            {section.items.map(({ key, href, icon: Icon }) => {
              const label = t.nav[key];
              const fullHref = slug(href);
              const isActive = pathname?.startsWith(fullHref);

              return (
                <Link
                  key={href}
                  href={fullHref}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-2.5 py-2',
                    'transition-colors duration-[150ms]',
                    'focus-visible:outline-none focus-visible:shadow-brand',
                    // D1: 밝은 pill 정본 — isActive 시 box-shadow inset 2px teal
                    isActive
                      ? 'font-medium'
                      : 'hover:bg-white/[0.06]',
                  )}
                  style={
                    isActive
                      ? {
                          background: 'var(--sidebar-active-bg)',
                          boxShadow: 'inset 2px 0 0 var(--sidebar-active-border)',
                          color: 'var(--sidebar-active-text, #16181D)',
                          fontSize: '13.5px',
                        }
                      : {
                          color: 'var(--sidebar-nav-text, rgba(255,255,255,0.6))',
                          fontSize: '13.5px',
                        }
                  }
                  title={!effectivelyExpanded ? label : undefined}
                >
                  {/* SHELL-7 항목 ③: 아이콘 17px */}
                  <Icon
                    size={17}
                    className={cn('shrink-0', isActive ? '' : 'text-white/40')}
                    style={isActive ? { color: 'var(--color-brand)' } : undefined}
                  />
                  {effectivelyExpanded && <span className="truncate flex-1">{label}</span>}
                  {key === 'queue' && (queueCountData?.count ?? 0) > 0 && (
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
        ))}
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
          'border border-white/10 bg-[#2A2A2A]',
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
