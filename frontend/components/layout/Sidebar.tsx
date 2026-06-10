'use client';

/**
 * Sidebar.tsx — ITSM 사이드바 (collapsed/expanded)
 *
 * 구조:
 * - 상단: WorkspaceSwitcher
 * - 중간: 네비게이션 항목 (티켓·고객·자산·계약·SLA·리포트)
 * - 하단: 로그아웃 버튼 + 사용자 아바타
 *
 * collapsed 상태: localStorage 'itsm.sidebar.collapsed' 저장
 * 모든 링크: useSlug()로 /{tenantSlug}/... prefix 보장
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LifeBuoy,
  Users,
  Package,
  FileText,
  Clock,
  BarChart2,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSlug } from '@/lib/slug';
import { useAuth } from '@/hooks/useAuth';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getInitials } from '@/lib/utils';

// -----------------------------------------------------------------------
// localStorage — collapsed 상태 초기값 (SSR guard 포함)
// -----------------------------------------------------------------------
const STORAGE_KEY = 'itsm.sidebar.collapsed';

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? false : stored === 'true';
}

// -----------------------------------------------------------------------
// 네비게이션 항목 정의
// -----------------------------------------------------------------------
const NAV_ITEMS = [
  { label: '티켓',   href: '/tickets',   icon: LifeBuoy  },
  { label: '고객',   href: '/customers', icon: Users     },
  { label: '자산',   href: '/assets',    icon: Package   },
  { label: '계약',   href: '/contracts', icon: FileText  },
  { label: 'SLA',    href: '/sla',       icon: Clock     },
  { label: '리포트', href: '/reports',   icon: BarChart2 },
] as const;

// -----------------------------------------------------------------------
// Sidebar 컴포넌트
// -----------------------------------------------------------------------
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const pathname = usePathname();
  const slug = useSlug();
  const { user, logout } = useAuth();

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
        // 다크 계열 사이드바 배경 (GW 패턴 동일)
        'bg-[#0E0E0C]',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* 상단: WorkspaceSwitcher */}
      <WorkspaceSwitcher collapsed={collapsed} />

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5" aria-label="메인 네비게이션">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
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
              {!collapsed && (
                <span className="truncate">{label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 하단: 사용자 + 로그아웃 */}
      <div className="border-t border-white/10 p-2 flex flex-col gap-1">
        {/* 로그아웃 버튼 */}
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

        {/* 사용자 아바타 */}
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
                <p className="text-[10px] text-white/40 truncate">{user.email}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* collapsed 토글 버튼 */}
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
