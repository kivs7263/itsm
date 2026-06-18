'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Languages } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/locale';

interface PortalNavProps {
  tenantSlug: string;
}

export function PortalNav({ tenantSlug }: PortalNavProps) {
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { locale, setLocale, t } = useLocale();

  const NAV_ITEMS = [
    { href: `/portal/${tenantSlug}`,          label: locale === 'ko' ? '홈' : 'Home',     exact: true  },
    { href: `/portal/${tenantSlug}/tickets`,   label: t.nav.tickets,                       exact: false },
    { href: `/portal/${tenantSlug}/knowledge`, label: t.nav.kb,                            exact: false },
    { href: `/portal/${tenantSlug}/assets`,    label: locale === 'ko' ? '자산' : 'Assets', exact: false },
    { href: `/portal/${tenantSlug}/contracts`, label: locale === 'ko' ? '계약' : 'Contracts', exact: false },
  ];

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await api.post(`/portal/${tenantSlug}/auth/logout`);
    } catch {
      // 실패해도 리다이렉트
    } finally {
      window.location.href = `/portal/${tenantSlug}/login`;
    }
  };

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-none shrink-0 max-w-[calc(100vw-180px)] sm:max-w-none">
      {NAV_ITEMS.map((item) => {
        const isActive = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'shrink-0 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors duration-fast whitespace-nowrap',
              isActive
                ? 'bg-surface-hover text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
            )}
          >
            {item.label}
          </Link>
        );
      })}

      <div className="mx-1 h-4 w-px shrink-0 bg-border-default" />

      {/* 언어 토글 */}
      <button
        type="button"
        onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}
        className={cn(
          'shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm',
          'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
          'transition-colors duration-fast',
        )}
        title={t.sidebar.language}
      >
        <Languages size={14} />
        <span className="hidden sm:inline text-xs font-medium">
          {locale === 'ko' ? 'KO' : 'EN'}
        </span>
      </button>

      {/* 로그아웃 */}
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        className={cn(
          'shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm min-w-[44px] min-h-[44px]',
          'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
          'transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        aria-label={t.auth.logout}
      >
        <LogOut size={14} />
        <span className="hidden sm:inline">{t.auth.logout}</span>
      </button>
    </nav>
  );
}
