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

// SHELL-7 항목 ③: 아이콘 17px 통일
const ENGINEER_ITEMS: NavItem[] = [
  { key: 'dashboard',       href: '/home',             icon: Home           },
  { key: 'tickets',         href: '/tickets',          icon: LifeBuoy       },
  { key: 'workLogs',        href: '/work-logs',        icon: Clock          },
  { key: 'customers',       href: '/customers',        icon: Users          },
  { key: 'kb',              href: '/kb',               icon: BookOpen       },
  { key: 'recurringIssues', href: '/recurring-alerts', icon: RefreshCw      },
  // CA-5: 운영 관리 메뉴 — page.tsx 실재 확인된 라우트만 등록
  { key: 'assets',          href: '/assets',           icon: Boxes          },
  { key: 'cmdb',            href: '/cmdb',             icon: Network        },
  { key: 'changeRequests',  href: '/change-requests',  icon: GitPullRequest },
  { key: 'sla',             href: '/sla',              icon: Gauge          },
  { key: 'contracts',       href: '/contracts',        icon: FileText       },
  // CA-P2-4: Problem Management
  { key: 'problems',        href: '/problems',         icon: Bug            },
  // FRP-3d-A1: 티켓 풀 (미배정 티켓)
  { key: 'queue',           href: '/queue',            icon: Inbox          },
];

const TEAM_LEAD_ITEMS: NavItem[] = [
  ...ENGINEER_ITEMS,
  { key: 'reports', href: '/reports', icon: BarChart2 },
];

const ADMIN_ITEMS: NavItem[] = [
  ...TEAM_LEAD_ITEMS,
  { key: 'settings', href: '/settings', icon: Settings },
];

const SALES_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/home',      icon: Home      },
  { key: 'customers', href: '/customers', icon: Users     },
  { key: 'reports',   href: '/reports',   icon: BarChart2 },
];

const C_LEVEL_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/home',    icon: Home      },
  { key: 'reports',   href: '/reports', icon: BarChart2 },
];

function getNavItems(role: UserRole | undefined): NavItem[] {
  if (isCLevel(role)) return C_LEVEL_ITEMS;
  if (isSales(role)) return SALES_ITEMS;
  if (isAdminRole(role)) return ADMIN_ITEMS;
  if (isTeamLeadOrAbove(role)) return TEAM_LEAD_ITEMS;
  return ENGINEER_ITEMS;
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

  const navItems = useMemo(() => getNavItems(user?.role as UserRole), [user?.role]);

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

      <nav className="flex-1 overflow-y-auto py-2 px-1.5" aria-label={t.nav.dashboard}>
        {navItems.map(({ key, href, icon: Icon }) => {
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
                      boxShadow: 'inset 2px 0 0 var(--color-brand)',
                      color: 'var(--sidebar-nav-active-text, #16181D)',
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
                  style={{ background: 'var(--color-error, #D2553F)' }}
                >
                  {queueCountData?.count}
                </span>
              )}
            </Link>
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
