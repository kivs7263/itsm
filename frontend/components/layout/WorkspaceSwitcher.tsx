'use client';

/**
 * WorkspaceSwitcher.tsx — ITSM 사이드바 상단 조직 스위처 + 앱 전환
 *
 * 4앱 그리드 (3열):
 *   - GW (Groupware): {GW_URL}/{slug}/home 직접 링크
 *   - SA (SA Workspace): crossapp/issue → crossapp?token= 리다이렉트
 *   - ITSM (현재): 브랜드 색 강조 + 활성 표시
 *   - Admin Portal: 새 탭으로 열기
 *
 * Radix DropdownMenu 사용
 */

import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Building2,
  LayoutDashboard,
  ShieldCheck,
  LifeBuoy,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

// 빌드 타임 주입 (NEXT_PUBLIC_* — Dockerfile ARG)
const SA_URL           = process.env.NEXT_PUBLIC_SA_URL           || undefined;
const GW_URL           = process.env.NEXT_PUBLIC_GW_URL           || undefined;
const ADMIN_PORTAL_URL = process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL || undefined;

function ItsmHexLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polygon points="14,1.5 24.8,7.75 24.8,20.25 14,26.5 3.2,20.25 3.2,7.75" fill="#F5C000" />
      {/* 헤드셋 심볼 — ITSM 아이덴티티 */}
      <path d="M9 14.5c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="#1A1A1A" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <rect x="7.5" y="14" width="2" height="3.5" rx="1" fill="#1A1A1A" />
      <rect x="18.5" y="14" width="2" height="3.5" rx="1" fill="#1A1A1A" />
    </svg>
  );
}

interface WorkspaceSwitcherProps {
  collapsed: boolean;
}

export function WorkspaceSwitcher({ collapsed }: WorkspaceSwitcherProps) {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string | undefined;
  const { user } = useAuth();

  const orgName = user?.organization_name ?? '내 조직';

  const handleSwitchToSA = async () => {
    if (!SA_URL) return;
    try {
      const res = await fetch('/api/auth/crossapp/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const target = tenantSlug
          ? `${SA_URL}/${tenantSlug}/auth/crossapp?token=${data.token}`
          : `${SA_URL}/auth/crossapp?token=${data.token}`;
        window.location.href = target;
      } else {
        window.location.href = tenantSlug
          ? `${SA_URL}/${tenantSlug}/compass`
          : SA_URL;
      }
    } catch {
      window.location.href = tenantSlug ? `${SA_URL}/${tenantSlug}/compass` : SA_URL!;
    }
  };

  const handleSwitchToGW = () => {
    if (!GW_URL) return;
    // GW는 직접 링크 (crossapp 미구현)
    const target = tenantSlug ? `${GW_URL}/${tenantSlug}/home` : GW_URL;
    window.location.href = target;
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2.5 w-full',
            'border-b border-white/10',
            'hover:bg-white/[0.06] transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:shadow-brand',
            collapsed ? 'px-3 justify-center py-3' : 'px-3 py-3',
          )}
          aria-label="조직 전환 메뉴"
        >
          <ItsmHexLogo size={26} />

          {!collapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p
                  className="text-sm font-bold text-white truncate"
                  style={{ letterSpacing: '-0.01em' }}
                >
                  {orgName}
                </p>
                <p
                  className="text-[10.5px] mt-0.5 truncate"
                  style={{
                    color: 'rgba(255,255,255,0.4)',
                    letterSpacing: '0.04em',
                  }}
                >
                  Alvio ITSM
                </p>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="shrink-0 text-white/40"
                aria-hidden="true"
              >
                <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
              </svg>
            </>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            'z-50 min-w-[240px] rounded-xl border border-border-strong',
            'bg-surface-elevated shadow-lg',
            'p-1',
            'animate-fade-in',
          )}
          sideOffset={4}
          align="start"
        >
          {/* 현재 조직 정보 */}
          <DropdownMenu.Item
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2 py-2',
              'text-sm text-text-primary cursor-default',
              'focus:bg-surface-hover focus:outline-none',
            )}
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: '#F5C000' }}
            >
              <LifeBuoy size={14} className="text-[#1A1A1A]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{orgName}</p>
              <p className="text-xs text-text-secondary truncate">현재 조직</p>
            </div>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border-default" />

          {/* 앱 전환 섹션 */}
          <div className="px-2 py-1">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">
              앱 전환
            </p>
          </div>

          {/* 앱 그리드 (3열) */}
          <div className="grid grid-cols-3 gap-1 p-1">
            {/* ITSM — 현재 앱 (브랜드 색 강조) */}
            <div
              className={cn(
                'flex flex-col items-center gap-1.5 p-2.5 rounded-lg relative',
              )}
              style={{ background: 'rgba(245, 192, 0, 0.12)' }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md"
                style={{ background: '#F5C000' }}
              >
                <LifeBuoy size={14} className="text-[#1A1A1A]" />
              </div>
              <span
                className="text-[11px] font-semibold text-center leading-tight"
                style={{ color: '#F5C000' }}
              >
                ITSM
              </span>
              {/* 활성 표시 dot */}
              <div
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                style={{ background: '#F5C000' }}
              />
            </div>

            {/* GW (Groupware) */}
            {GW_URL ? (
              <button
                type="button"
                className={cn(
                  'flex flex-col items-center gap-1.5 p-2.5 rounded-lg cursor-pointer',
                  'bg-transparent hover:bg-surface-hover transition-colors',
                  'border-0',
                )}
                onClick={handleSwitchToGW}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover text-text-secondary">
                  <Building2 size={14} />
                </div>
                <span className="text-[11px] font-medium text-text-secondary text-center leading-tight">GW</span>
              </button>
            ) : (
              <div className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg opacity-30 cursor-not-allowed">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover">
                  <Building2 size={14} className="text-text-disabled" />
                </div>
                <span className="text-[11px] font-medium text-text-disabled text-center leading-tight">GW</span>
              </div>
            )}

            {/* SA Workspace */}
            {SA_URL ? (
              <button
                type="button"
                className={cn(
                  'flex flex-col items-center gap-1.5 p-2.5 rounded-lg cursor-pointer',
                  'bg-transparent hover:bg-surface-hover transition-colors',
                  'border-0',
                )}
                onClick={handleSwitchToSA}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover text-text-secondary">
                  <LayoutDashboard size={14} />
                </div>
                <span className="text-[11px] font-medium text-text-secondary text-center leading-tight">SA</span>
              </button>
            ) : (
              <div className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg opacity-30 cursor-not-allowed">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover">
                  <LayoutDashboard size={14} className="text-text-disabled" />
                </div>
                <span className="text-[11px] font-medium text-text-disabled text-center leading-tight">SA</span>
              </div>
            )}

            {/* Admin Portal */}
            {ADMIN_PORTAL_URL ? (
              <button
                type="button"
                className={cn(
                  'flex flex-col items-center gap-1.5 p-2.5 rounded-lg cursor-pointer',
                  'bg-transparent hover:bg-surface-hover transition-colors',
                  'border-0',
                )}
                onClick={() => window.open(ADMIN_PORTAL_URL, '_blank', 'noopener')}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover text-text-secondary">
                  <ShieldCheck size={14} />
                </div>
                <span className="text-[11px] font-medium text-text-secondary text-center leading-tight">Admin</span>
              </button>
            ) : (
              <div className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg opacity-30 cursor-not-allowed">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover">
                  <ShieldCheck size={14} className="text-text-disabled" />
                </div>
                <span className="text-[11px] font-medium text-text-disabled text-center leading-tight">Admin</span>
              </div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
