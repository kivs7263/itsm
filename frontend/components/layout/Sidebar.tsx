'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  Languages,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSlug } from '@/lib/slug';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isSales, isCLevel, isAdminRole, type UserRole } from '@/lib/auth';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getInitials } from '@/lib/utils';
import { useLocale, type Locale } from '@/lib/locale';

const STORAGE_KEY = 'itsm.sidebar.collapsed';

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? false : stored === 'true';
}

type NavKey = 'dashboard' | 'tickets' | 'workLogs' | 'customers' | 'kb' | 'recurringIssues' | 'reports' | 'settings';
type NavItem = { key: NavKey; href: string; icon: React.ElementType };

const ENGINEER_ITEMS: NavItem[] = [
  { key: 'dashboard',       href: '/home',             icon: Home      },
  { key: 'tickets',         href: '/tickets',          icon: LifeBuoy  },
  { key: 'workLogs',        href: '/work-logs',        icon: Clock     },
  { key: 'customers',       href: '/customers',        icon: Users     },
  { key: 'kb',              href: '/kb',               icon: BookOpen  },
  { key: 'recurringIssues', href: '/recurring-alerts', icon: RefreshCw },
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
  const { locale, setLocale, t } = useLocale();

  const navItems = useMemo(() => getNavItems(user?.role as UserRole), [user?.role]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  const toggleLocale = () => setLocale(locale === 'ko' ? 'en' : 'ko');

  return (
    <aside
      className={cn(
        'flex h-screen flex-col',
        'border-r border-white/10',
        'transition-[width] duration-200 ease-out',
        'bg-[#1A1A1A]',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      <WorkspaceSwitcher collapsed={collapsed} />

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
                'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm',
                'transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:shadow-brand',
                isActive
                  ? 'text-white font-medium'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.06]',
              )}
              style={isActive ? { background: 'var(--sidebar-active-bg)' } : undefined}
              title={collapsed ? label : undefined}
            >
              <Icon size={16} className={cn('shrink-0', isActive ? 'text-[#129B8E]' : 'text-white/40')} />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* 하단: 언어 토글 + 로그아웃 + 사용자 */}
      <div className="border-t border-white/10 p-2 flex flex-col gap-1">
        {/* 언어 선택 */}
        <button
          type="button"
          onClick={toggleLocale}
          className={cn(
            'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm w-full',
            'text-white/60 hover:text-white hover:bg-white/[0.06]',
            'transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-brand',
            collapsed && 'justify-center',
          )}
          title={collapsed ? t.sidebar.language : undefined}
        >
          <Languages size={16} className="shrink-0 text-white/40" />
          {!collapsed && (
            <span className="flex items-center gap-2 flex-1">
              <span className="flex-1">{t.sidebar.language}</span>
              <span className="text-[11px] font-medium text-[#129B8E]">
                {locale === 'ko' ? 'KO' : 'EN'}
              </span>
            </span>
          )}
        </button>

        {/* 로그아웃 */}
        <button
          type="button"
          onClick={logout}
          className={cn(
            'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm w-full',
            'text-white/60 hover:text-white hover:bg-white/[0.06]',
            'transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-brand',
            collapsed && 'justify-center',
          )}
          title={collapsed ? t.auth.logout : undefined}
        >
          <LogOut size={16} className="shrink-0 text-white/40" />
          {!collapsed && <span>{t.auth.logout}</span>}
        </button>

        {/* 사용자 */}
        {user && (
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2',
              collapsed && 'justify-center',
            )}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: '#129B8E', color: '#1A1A1A' }}
              title={user.name}
            >
              {getInitials(user.name)}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate">{user.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-white/40 truncate">{user.email}</span>
                  {user.role && (
                    <span className="shrink-0 rounded px-1 py-px text-[9px] font-medium bg-white/10 text-white/60">
                      {t.auth.role[user.role as UserRole] ?? user.role}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* collapsed 토글 */}
      <button
        type="button"
        onClick={toggleCollapsed}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full',
          'absolute -right-3 top-1/2 -translate-y-1/2',
          'border border-white/10 bg-[#1A1A1A]',
          'text-white/40 hover:text-white transition-colors duration-fast',
          'focus-visible:outline-none focus-visible:shadow-brand',
          'z-10',
        )}
        aria-label={collapsed ? t.sidebar.open : t.sidebar.close}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
