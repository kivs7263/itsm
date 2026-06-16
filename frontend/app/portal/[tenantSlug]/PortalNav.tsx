'use client';

/**
 * PortalNav.tsx — 포털 헤더 오른쪽 내비게이션 (클라이언트 컴포넌트)
 *
 * layout.tsx는 서버 컴포넌트이므로 'use client' 경계를 별도 파일로 분리.
 * 로그아웃: POST /api/portal/{tenantSlug}/auth/logout → login 페이지로
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, LogOut, BookOpen } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

interface PortalNavProps {
  tenantSlug: string;
}

const NAV_ITEMS = [
  { href: (slug: string) => `/portal/${slug}`, label: '홈', exact: true },
  { href: (slug: string) => `/portal/${slug}/tickets`, label: '티켓', exact: false },
  { href: (slug: string) => `/portal/${slug}/knowledge`, label: '자주 묻는 질문', exact: false },
  { href: (slug: string) => `/portal/${slug}/assets`, label: '자산', exact: false },
  { href: (slug: string) => `/portal/${slug}/contracts`, label: '계약', exact: false },
];

export function PortalNav({ tenantSlug }: PortalNavProps) {
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await api.post(`/portal/${tenantSlug}/auth/logout`);
    } catch {
      // 실패해도 클라이언트 리다이렉트는 수행
    } finally {
      window.location.href = `/portal/${tenantSlug}/login`;
    }
  };

  return (
    <nav className="flex items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const href = item.href(tenantSlug);
        const isActive = item.exact ? pathname === href : pathname?.startsWith(href);
        return (
          <Link
            key={item.label}
            href={href}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-fast',
              isActive
                ? 'bg-surface-hover text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
            )}
          >
            {item.label}
          </Link>
        );
      })}

      {/* 구분선 */}
      <div className="mx-1 h-4 w-px bg-border-default" />

      {/* 로그아웃 */}
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm',
          'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
          'transition-colors duration-fast',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        aria-label="로그아웃"
      >
        <LogOut size={14} />
        <span className="hidden sm:inline">로그아웃</span>
      </button>
    </nav>
  );
}
