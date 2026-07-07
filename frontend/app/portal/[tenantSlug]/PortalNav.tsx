'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut, Languages, ChevronDown } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/locale';

interface PortalNavProps {
  tenantSlug: string;
}

// IPA-4(2026-07-07): 주동선(요청/티켓/지식) 선명화 — 자산·계약은 '내 서비스'
// 보조그룹으로 강등. 라우트는 유지, 네비 위치·시각 위계만 변경.
export function PortalNav({ tenantSlug }: PortalNavProps) {
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { locale, setLocale, t } = useLocale();

  // 주동선: 홈 / 서비스 요청 / 티켓 / 지식
  const PRIMARY_ITEMS = [
    { href: `/portal/${tenantSlug}`,          label: locale === 'ko' ? '홈' : 'Home',              exact: true  },
    { href: `/portal/${tenantSlug}/catalog`,   label: locale === 'ko' ? '서비스 요청' : 'Services', exact: false },
    { href: `/portal/${tenantSlug}/tickets`,   label: t.nav.tickets,                                exact: false },
    { href: `/portal/${tenantSlug}/knowledge`, label: t.nav.kb,                                     exact: false },
  ];

  // 보조그룹: 내 서비스 (자산·계약) — 조회 빈도 낮은 참고 정보
  const SECONDARY_ITEMS = [
    { href: `/portal/${tenantSlug}/assets`,    label: t.nav.assets },
    { href: `/portal/${tenantSlug}/contracts`, label: t.nav.contracts },
  ];
  const secondaryActive = SECONDARY_ITEMS.some((item) => pathname?.startsWith(item.href));
  const [secondaryOpen, setSecondaryOpen] = useState(false);

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
      {PRIMARY_ITEMS.map((item) => {
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

      {/* 보조그룹: 내 서비스 (자산·계약) — 강등된 저빈도 참고 정보 */}
      <DropdownMenu.Root open={secondaryOpen} onOpenChange={setSecondaryOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={cn(
              'shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm font-medium whitespace-nowrap',
              'transition-colors duration-fast',
              secondaryActive
                ? 'bg-surface-hover text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
            )}
            aria-label={locale === 'ko' ? '내 서비스 메뉴' : 'My Services menu'}
          >
            {locale === 'ko' ? '내 서비스' : 'My Services'}
            <ChevronDown size={13} className={cn('transition-transform', secondaryOpen && 'rotate-180')} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className={cn(
              'z-[200] min-w-[10rem] rounded-lg border border-border-default bg-surface shadow-lg py-1',
              'animate-in fade-in-0 zoom-in-95',
            )}
          >
            {SECONDARY_ITEMS.map((item) => {
              const isActive = pathname?.startsWith(item.href);
              return (
                <DropdownMenu.Item key={item.href} asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      'block px-3 py-2 text-sm outline-none cursor-pointer transition-colors',
                      isActive
                        ? 'bg-surface-hover text-text-primary font-medium'
                        : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                    )}
                  >
                    {item.label}
                  </Link>
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

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
