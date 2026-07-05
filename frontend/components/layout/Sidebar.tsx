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
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSlug } from '@/lib/slug';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isSales, isCLevel, isAdminRole, type UserRole } from '@/lib/auth';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getInitials } from '@/lib/utils';
import { useLocale } from '@/lib/locale';
import { api } from '@/lib/api';
import { fetchSidebarPins, saveSidebarPins } from '@/lib/api/sidebarPins';

const STORAGE_KEY = 'itsm.sidebar.collapsed';

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? false : stored === 'true';
}

// RX-1c: assets·cmdb 2개 항목 → 단일 'inventory'(인프라)로 통합
// IA-2 재구조화(2026-07-04, docs/design/2026-07-04_sidebar_ia_redesign.md):
//   ① 설정/사용자 딥링크 nav 제거 → 하단 고정 '설정' 기어(admin) 단일 진입점 (세부는 /settings 10탭)
//   ② 알림(notifications) 사이드바 제거 → 헤더 벨 + 모바일 시트가 도달 보장
//   ③ infra+knowledge 단일항목 섹션 병합 → 'assetsKnowledge'(자산·지식)
//   ④ reports를 admin 섹션에서 빼 상단 리딩 그룹으로 승격
//   ⑤ sales에 contracts 추가
type NavKey = 'dashboard' | 'tickets' | 'workLogs' | 'customers' | 'kb' | 'reports' | 'inventory' | 'changeRequests' | 'sla' | 'contracts' | 'problems' | 'automation' | 'serviceCatalog';
type NavItem = { key: NavKey; href: string; icon: React.ElementType };
// 섹션: titleKey 없으면 무제목 리딩 그룹(홈·리포트), 있으면 t.nav.sections[titleKey] 라벨.
// 단일항목 섹션 금지 원칙 — 2개 미만은 무제목 그룹으로 흡수.
type SectionKey = 'work' | 'serviceMgmt' | 'customers' | 'assetsKnowledge';
type NavSection = { titleKey?: SectionKey; items: NavItem[] };

const ENGINEER_SECTIONS: NavSection[] = [
  {
    // 리딩 그룹(무제목): engineer는 reports 미노출 → 홈만
    items: [
      { key: 'dashboard', href: '/home', icon: Home },
    ],
  },
  {
    titleKey: 'work',
    items: [
      // RX-4c: 티켓 풀은 tickets 페이지 "티켓 풀" 탭(?view=pool)으로 흡수
      { key: 'tickets',  href: '/tickets',   icon: LifeBuoy },
      { key: 'workLogs', href: '/work-logs',  icon: Clock    },
    ],
  },
  {
    titleKey: 'serviceMgmt',
    items: [
      { key: 'changeRequests',  href: '/change-requests',  icon: GitPullRequest },
      // RX-4c: 반복 이슈는 problems "반복 감지" 탭(?tab=recurring)으로 흡수
      { key: 'problems',        href: '/problems',         icon: Bug            },
      { key: 'sla',             href: '/sla',              icon: Gauge          },
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
    // IA-2 ③: infra(인벤토리)+knowledge(KB) 단일 섹션 병합
    titleKey: 'assetsKnowledge',
    items: [
      { key: 'inventory', href: '/inventory', icon: Boxes    },
      { key: 'kb',        href: '/kb',        icon: BookOpen },
    ],
  },
];

const TEAM_LEAD_SECTIONS: NavSection[] = [
  {
    // IA-2 ④: reports를 상단 리딩 그룹으로 승격(홈·리포트)
    items: [
      { key: 'dashboard', href: '/home',    icon: Home      },
      { key: 'reports',   href: '/reports', icon: BarChart2 },
    ],
  },
  {
    titleKey: 'work',
    items: [
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
      // 자동화·서비스카탈로그: 초기 셋업 성격 → 서비스관리 최하단 유지(사용자 결정 2026-07-04)
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
    titleKey: 'assetsKnowledge',
    items: [
      { key: 'inventory', href: '/inventory', icon: Boxes    },
      { key: 'kb',        href: '/kb',        icon: BookOpen },
    ],
  },
];

// IA-2: admin의 스크롤 nav = team_lead와 동일. 차이는 하단 고정 '설정' 기어(isAdminRole)뿐.
const ADMIN_SECTIONS: NavSection[] = TEAM_LEAD_SECTIONS;

const SALES_SECTIONS: NavSection[] = [
  // IA-2 ⑤: contracts 추가(파이프라인 운영자 결함 보강). 전부 무제목 리딩 그룹.
  {
    items: [
      { key: 'dashboard', href: '/home',      icon: Home      },
      { key: 'reports',   href: '/reports',   icon: BarChart2 },
      { key: 'customers', href: '/customers', icon: Users     },
      { key: 'contracts', href: '/contracts', icon: FileText  },
    ],
  },
];

const C_LEVEL_SECTIONS: NavSection[] = [
  { items: [
    { key: 'dashboard', href: '/home',    icon: Home      },
    { key: 'reports',   href: '/reports', icon: BarChart2 },
  ] },
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

  // 즐겨찾기(pin) — ITSM-SIDEBAR-P1. 사용자별 영속(GET/PUT /api/{slug}/sidebar/pins), 낙관적 업데이트.
  // pin key = NavItem.key(NavKey) — role별 섹션이 달라도 안정적으로 유지되는 식별자.
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!tenantSlug) return;
    let cancelled = false;
    fetchSidebarPins(tenantSlug)
      .then((res) => { if (!cancelled) setPinnedKeys(res.pinned_keys); })
      .catch(() => { /* 조회 실패 시 즐겨찾기 없음으로 취급 (기능 저하 없이 기본 nav만) */ });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const togglePin = useCallback((key: string) => {
    if (!tenantSlug) return;
    setPinnedKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      saveSidebarPins(tenantSlug, { pinned_keys: next }).catch(() => {
        // 저장 실패 시 롤백 (낙관적 업데이트 취소)
        setPinnedKeys(prev);
      });
      return next;
    });
  }, [tenantSlug]);

  // 즐겨찾기 그룹 표시용 — 현재 role nav에 존재하는 항목 중 pin된 것만, pinnedKeys 순서대로
  // (원 섹션에도 그대로 유지 — Linear식 "즐겨찾기에 복제 표시", SA sidebar_pins 동일 패턴)
  const favoriteItems = useMemo(() => {
    const visible = navSections.flatMap((section) => section.items);
    const byKey = new Map(visible.map((item) => [item.key, item]));
    return pinnedKeys
      .map((key) => byKey.get(key as NavKey))
      .filter((item): item is NavItem => !!item);
  }, [navSections, pinnedKeys]);

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

  // 단일 nav 항목 렌더 — 원 섹션·즐겨찾기 그룹 공용 (ITSM-SIDEBAR-P1).
  // forcePinned: 즐겨찾기 그룹 복제본은 항상 pinned 취급(별표 항상 채움 표시).
  function renderNavItem(
    { key, href, icon: Icon }: NavItem,
    opts?: { keyPrefix?: string; forcePinned?: boolean },
  ) {
    const label = t.nav[key];
    const fullHref = slug(href);
    // RX-4b: 쿼리스트링 딥링크(/settings?tab=users 등)는 정확 일치로,
    // 그 외 일반 경로는 기존 prefix 매칭 그대로 유지
    const [hrefPath, hrefQuery] = fullHref.split('?');
    const isActive = hrefQuery
      ? pathname === hrefPath && (searchParams?.toString() ?? '') === hrefQuery
      : pathname?.startsWith(fullHref);
    const isPinned = opts?.forcePinned || pinnedKeys.includes(key);
    // collapsed(아이콘레일)에선 공간 부족으로 별표 토글 숨김
    const showPinToggle = effectivelyExpanded;

    return (
      <Link
        key={`${opts?.keyPrefix ?? ''}${href}`}
        href={fullHref}
        className={cn(
          'group/navitem flex items-center gap-3 rounded-md px-2.5 py-2',
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
        {showPinToggle && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              togglePin(key);
            }}
            className={cn(
              'flex-shrink-0 flex items-center transition-opacity duration-fast',
              isPinned ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover/navitem:opacity-100 hover:opacity-100',
            )}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, marginLeft: 2 }}
            aria-label={isPinned ? t.nav.unpin : t.nav.pin}
            title={isPinned ? t.nav.unpin : t.nav.pin}
          >
            <Star
              size={13}
              fill={isPinned ? 'var(--color-brand)' : 'none'}
              style={{ color: isPinned ? 'var(--color-brand)' : 'rgba(255,255,255,0.5)' }}
            />
          </button>
        )}
      </Link>
    );
  }

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
        {/* 즐겨찾기(pin) 그룹 — ITSM-SIDEBAR-P1. 원 섹션 항목을 복제 표시(Linear식), 비어있으면 그룹 자체 미노출 */}
        {favoriteItems.length > 0 && (
          <div>
            {effectivelyExpanded && (
              <div className="w-full flex items-center px-2.5 py-1.5 mb-2">
                <span
                  className="text-[12px] font-semibold truncate"
                  style={{ color: 'var(--sidebar-section-text, rgba(255,255,255,0.4))' }}
                >
                  {t.nav.favorites}
                </span>
              </div>
            )}
            {favoriteItems.map((item) =>
              renderNavItem(item, { keyPrefix: 'fav-', forcePinned: true }),
            )}
          </div>
        )}
        {navSections.map((section, si) => {
          const sectionKey = section.titleKey;

          return (
          <div key={sectionKey ?? `section-${si}`}>
            {/* PU-N4: 아코디언(클릭 접이) 제거 — 정적 그룹 라벨(비접이). 아이콘 레일 축소 시엔 라벨 자체를 숨김(항목은 그대로 아이콘 노출). */}
            {sectionKey && effectivelyExpanded && (
              <div
                className="w-full flex items-center px-2.5 py-1.5 mb-2"
              >
                <span
                  className="text-[12px] font-semibold truncate"
                  style={{ color: 'var(--sidebar-section-text, rgba(255,255,255,0.4))' }}
                >
                  {t.nav.sections[sectionKey]}
                </span>
              </div>
            )}
            {section.items.map((item) => renderNavItem(item))}
          </div>
          );
        })}
      </nav>

      {/* 하단: 사용자 카드 1행 (SHELL-7 항목 ④) — D2: 언어 토글은 헤더 UserMenu로 통합 */}
      <div
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        className="p-2 flex flex-col gap-1"
      >
        {/* IA-2 ①: 설정 단일 진입점(admin 전용) — 스크롤 nav 밖 하단 고정.
            세부(사용자·SLA·분류·이메일·API·웹훅·구독·일반)는 /settings 10탭이 담당. */}
        {isAdminRole(user?.role as UserRole) && (() => {
          const settingsHref = slug('/settings');
          const settingsActive = pathname?.startsWith(settingsHref) ?? false;
          return (
            <Link
              href={settingsHref}
              className={cn(
                'flex items-center gap-3 rounded-md px-2.5 py-2',
                'transition-colors duration-[150ms] focus-visible:outline-none focus-visible:shadow-brand',
                settingsActive ? 'font-semibold' : 'hover:bg-white/[0.06]',
                !effectivelyExpanded && 'justify-center',
              )}
              style={
                settingsActive
                  ? { background: 'var(--sidebar-active-bg)', color: 'var(--sidebar-active-text, #F5F5F5)', fontSize: '14px' }
                  : { color: 'var(--sidebar-nav-text, rgba(255,255,255,0.6))', fontSize: '14px' }
              }
              title={!effectivelyExpanded ? t.nav.settings : undefined}
            >
              <Settings
                size={16}
                className={cn('shrink-0', settingsActive ? '' : 'text-white/40')}
                style={settingsActive ? { color: 'var(--color-brand)' } : undefined}
              />
              {effectivelyExpanded && <span className="truncate flex-1">{t.nav.settings}</span>}
            </Link>
          );
        })()}
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
