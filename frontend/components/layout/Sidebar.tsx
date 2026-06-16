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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSlug } from '@/lib/slug';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isSales, isCLevel, isAdminRole, type UserRole } from '@/lib/auth';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getInitials } from '@/lib/utils';

// -----------------------------------------------------------------------
// localStorage — collapsed 상태 초기값
// -----------------------------------------------------------------------
const STORAGE_KEY = 'itsm.sidebar.collapsed';

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? false : stored === 'true';
}

// -----------------------------------------------------------------------
// 역할별 NAV_ITEMS 정의
// -----------------------------------------------------------------------
type NavItem = { label: string; href: string; icon: React.ElementType };

// 역할별 nav 항목 (사이드바 15개 → 역할별 5~7개로 정리)
// 자산·CMDB·계약은 고객 상세 탭에서 관리. 알림은 헤더 벨. 캘린더는 미구현 제거.
const ENGINEER_ITEMS: NavItem[] = [
  { label: '대시보드',   href: '/home',             icon: Home      },
  { label: '티켓',       href: '/tickets',          icon: LifeBuoy  },
  { label: '작업 시간',  href: '/work-logs',        icon: Clock     },
  { label: '고객',       href: '/customers',        icon: Users     },
  { label: '지식베이스', href: '/kb',               icon: BookOpen  },
  { label: '반복 이슈',  href: '/recurring-alerts', icon: RefreshCw },
];

const TEAM_LEAD_ITEMS: NavItem[] = [
  ...ENGINEER_ITEMS,
  { label: '리포트', href: '/reports', icon: BarChart2 },
];

const ADMIN_ITEMS: NavItem[] = [
  ...TEAM_LEAD_ITEMS,
  { label: '설정', href: '/settings', icon: Settings },
];

const SALES_ITEMS: NavItem[] = [
  { label: '대시보드', href: '/home',      icon: Home      },
  { label: '고객',     href: '/customers', icon: Users     },
  { label: '리포트',   href: '/reports',   icon: BarChart2 },
];

const C_LEVEL_ITEMS: NavItem[] = [
  { label: '대시보드', href: '/home',    icon: Home      },
  { label: '리포트',   href: '/reports', icon: BarChart2 },
];

function getNavItems(role: UserRole | undefined): NavItem[] {
  if (isCLevel(role)) return C_LEVEL_ITEMS;
  if (isSales(role)) return SALES_ITEMS;
  if (isAdminRole(role)) return ADMIN_ITEMS;
  if (isTeamLeadOrAbove(role)) return TEAM_LEAD_ITEMS;
  return ENGINEER_ITEMS;
}

const ROLE_LABELS: Record<UserRole, string> = {
  engineer:   '엔지니어',
  team_lead:  '팀장',
  admin:      '관리자',
  customer:   '고객',
  sales:      '영업',
  c_level:    'C-Level',
};

// -----------------------------------------------------------------------
// Sidebar 컴포넌트
// -----------------------------------------------------------------------
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const pathname = usePathname();
  const slug = useSlug();
  const { user, logout } = useAuth();

  const navItems = useMemo(() => getNavItems(user?.role as UserRole), [user?.role]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        'flex h-screen flex-col',
        'border-r border-white/10',
        'transition-[width] duration-200 ease-out',
        'bg-[#0E0E0C]',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* 상단: WorkspaceSwitcher */}
      <WorkspaceSwitcher collapsed={collapsed} />

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5" aria-label="메인 네비게이션">
        {navItems.map(({ label, href, icon: Icon }) => {
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
              <Icon
                size={16}
                className={cn(
                  'shrink-0',
                  isActive ? 'text-[#F5C000]' : 'text-white/40',
                )}
              />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* 하단: 사용자 + 역할 배지 + 로그아웃 */}
      <div className="border-t border-white/10 p-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={logout}
          className={cn(
            'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm w-full',
            'text-white/60 hover:text-white hover:bg-white/[0.06]',
            'transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:shadow-brand',
            collapsed && 'justify-center',
          )}
          title={collapsed ? '로그아웃' : undefined}
        >
          <LogOut size={16} className="shrink-0 text-white/40" />
          {!collapsed && <span>로그아웃</span>}
        </button>

        {user && (
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2',
              collapsed && 'justify-center',
            )}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: '#F5C000', color: '#1A1A1A' }}
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
                      {ROLE_LABELS[user.role as UserRole] ?? user.role}
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
          'border border-white/10 bg-[#0E0E0C]',
          'text-white/40 hover:text-white transition-colors duration-fast',
          'focus-visible:outline-none focus-visible:shadow-brand',
          'z-10',
        )}
        aria-label={collapsed ? '사이드바 열기' : '사이드바 닫기'}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
