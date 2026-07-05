'use client';

/**
 * CommandPalette — ITSM Cmd+K / Ctrl+K 팔레트 (ELEVATE-1 P1-4-A)
 *
 * - cmdk 라이브러리 미사용, native React 구현
 * - ⌘K / Ctrl+K 토글, Esc 닫기, ↑↓ 이동, Enter 선택
 * - 탭 1: NAV (Sidebar 라우트 미러), 탭 2: 콘텐츠 검색 (unified_search API)
 * - 검색 디바운스 300ms, race condition → reqIdRef + cancelled flag
 * - CA-P1-3 Phase 3b: 로컬 ITSM 검색 + /api/search/global-proxy(GW+SA) 병렬 호출
 *   · Promise.allSettled 병렬, proxy 실패 시 graceful (ITSM 로컬만)
 *   · source별 섹션: ITSM(티켓·KB) + 그룹웨어(GW) + SA 워크스페이스(SA)
 *   · crossapp 이동: GW/SA → window.open(_blank), ITSM → 기존 내부 router.push
 * - hooks: 모두 조건부 return 이전 선언 ("Rendered more hooks" 방지)
 * - @total/ui-shell 골격 소비 (SHELL-5 5c):
 *   CommandPaletteShell: 오버레이+포털+600px
 *   useAutoTab: query 입력 시 nav→search 자동 전환 (원 ITSM:120~125 패턴을 골격 훅으로)
 *   useKeyboardNav: ↑↓ Enter Esc 상태머신 (원 hand-rolled 패턴을 골격 훅으로)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPaletteShell, useAutoTab, useKeyboardNav } from '@total/ui-shell';
import {
  Search,
  ArrowRight,
  Home,
  LifeBuoy,
  Clock,
  Users,
  BookOpen,
  RefreshCw,
  BarChart2,
  Settings,
  Loader2,
  FileText,
  GitPullRequest,
  Bug,
  Gauge,
  Boxes,
  Workflow,
  LayoutGrid,
} from 'lucide-react';
import { api } from '@/lib/api';

// -----------------------------------------------------------------------
// NAV 항목 (Sidebar.tsx ENGINEER_ITEMS 기반 — 모든 역할에서 접근 가능한 항목)
// -----------------------------------------------------------------------
interface NavItem {
  label: string;
  href: string;          // relative, prefixed with /{tenantSlug} at runtime
  section: string;
  icon: React.ElementType;
}

// IA-2(2026-07-04): Sidebar 트리와 1:1 미러. 팔레트는 무게이팅(파워유저 검색) — 역할별 접근 불가 페이지는 서버가 403.
const NAV_ITEMS: NavItem[] = [
  { section: '대시보드',     label: '홈',            href: '/home',             icon: Home           },
  { section: '작업',         label: '티켓 목록',     href: '/tickets',          icon: LifeBuoy       },
  // ITSM-NAV-A(2026-07-05): Sidebar.tsx 라벨 변경과 동기화 ('작업 시간'→'작업 기록', '변경 요청'→'변경')
  { section: '작업',         label: '작업 기록',     href: '/work-logs',        icon: Clock          },
  { section: '서비스 관리',  label: '변경',          href: '/change-requests',  icon: GitPullRequest },
  { section: '서비스 관리',  label: '문제 관리',     href: '/problems',         icon: Bug            },
  { section: '서비스 관리',  label: '반복 감지',     href: '/problems?tab=recurring', icon: RefreshCw },
  { section: '서비스 관리',  label: 'SLA',           href: '/sla',              icon: Gauge          },
  { section: '서비스 관리',  label: '자동화',        href: '/automation',       icon: Workflow       },
  { section: '서비스 관리',  label: '서비스 카탈로그', href: '/service-catalog', icon: LayoutGrid     },
  { section: '고객',         label: '고객 목록',     href: '/customers',        icon: Users          },
  { section: '고객',         label: '계약',          href: '/contracts',        icon: FileText       },
  { section: '자산·지식',    label: '인프라',        href: '/inventory',        icon: Boxes          },
  { section: '자산·지식',    label: '지식베이스',    href: '/kb',               icon: BookOpen       },
  { section: '분석',         label: '리포트',        href: '/reports',          icon: BarChart2      },
  { section: '설정',         label: '설정',          href: '/settings',         icon: Settings       },
];

// -----------------------------------------------------------------------
// 로컬 ITSM 검색 API 응답 타입
// GET /{tenant_slug}/search?q=...&type=all&limit=10
// 응답: { tickets: [{id, title, status, score}], kb: [{id, title, score}] }
// -----------------------------------------------------------------------
interface SearchTicket {
  id: string;
  title: string;
  status: string;
  score?: number;
}

interface SearchKb {
  id: string;
  title: string;
  score?: number;
}

interface SearchResult {
  tickets: SearchTicket[];
  kb: SearchKb[];
}

// -----------------------------------------------------------------------
// ADR-051 §2.6.5: 글로벌 프록시 응답 타입
// GET /api/search/global-proxy?q=...&limit=10
// 응답: { items: [{id,type,title,subtitle,href,source:"GW"|"SA",score?}], partial?, failed_sources? }
// -----------------------------------------------------------------------
interface GlobalProxyItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  href: string;
  source: 'GW' | 'SA';
  score?: number;
}

interface GlobalProxyResponse {
  items: GlobalProxyItem[];
  partial?: boolean;
  failed_sources?: string[];
}

// -----------------------------------------------------------------------
// 플랫 검색 항목 (↑↓ 키보드 이동용 통합 인덱스)
// ITSM 로컬(ticket·kb) + GW + SA 순서
// -----------------------------------------------------------------------
type FlatSearchItem =
  | { type: 'ticket'; id: string; title: string; source: 'ITSM' }
  | { type: 'kb'; id: string; title: string; source: 'ITSM' }
  | { type: 'global'; id: string; title: string; href: string; source: 'GW' | 'SA'; subtitle?: string };

// -----------------------------------------------------------------------
// CommandPaletteProps
// -----------------------------------------------------------------------
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string;
}

// source badge 스타일 헬퍼 (GW=앰버, SA=바이올렛 — 각 제품 브랜드 색)
function getSourceBadgeStyle(src: 'GW' | 'SA'): React.CSSProperties {
  return src === 'GW'
    ? { background: 'rgba(227,165,60,0.15)', color: '#E3A53C' }
    : { background: 'rgba(110,99,230,0.15)', color: '#8B80F0' };
}

// -----------------------------------------------------------------------
// CommandPalette
// -----------------------------------------------------------------------
export function CommandPalette({ open, onOpenChange, tenantSlug }: CommandPaletteProps) {
  const router = useRouter();

  const [query, setQuery] = useState('');

  // 로컬 ITSM 검색 결과 상태 (티켓·KB)
  const [results, setResults] = useState<SearchResult>({ tickets: [], kb: [] });
  const [searching, setSearching] = useState(false);

  // ADR-051 §2.6.5: 글로벌 프록시(GW+SA) 결과 상태
  const [globalResults, setGlobalResults] = useState<GlobalProxyItem[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // race condition 방지 — 최신 요청 ID
  const reqIdRef = useRef(0);

  // open 시 상태 초기화 + 포커스
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults({ tickets: [], kb: [] });
      setSearching(false);
      setGlobalResults([]);
      setGlobalLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // SHELL-5 5c: 골격 useAutoTab — query 입력 시 nav→search 자동 전환
  // 원 ITSM CommandPalette.tsx:120~125 패턴을 골격 훅으로 일반화
  const { tab } = useAutoTab({
    query,
    searchMode: 'search',
    navMode: 'nav',
    minLength: 1,
  });

  // nav 탭 필터링 (tab 파생 — 훅 이전에 계산하면 안 됨. 여기서는 tab 이후 선언 OK)
  const filteredNav = query.trim()
    ? NAV_ITEMS.filter(
        (it) =>
          it.label.toLowerCase().includes(query.toLowerCase()) ||
          it.section.toLowerCase().includes(query.toLowerCase()),
      )
    : NAV_ITEMS;

  // source별 글로벌 결과 분리
  const gwItems = globalResults.filter((i) => i.source === 'GW');
  const saItems = globalResults.filter((i) => i.source === 'SA');

  // 검색 탭 플랫 항목 (↑↓ 이동용) — ITSM 로컬(티켓→KB) + GW + SA 순서
  const flatSearchItems: FlatSearchItem[] = [
    ...results.tickets.map((t) => ({ type: 'ticket' as const, id: t.id, title: t.title, source: 'ITSM' as const })),
    ...results.kb.map((k) => ({ type: 'kb' as const, id: k.id, title: k.title, source: 'ITSM' as const })),
    ...gwItems.map((i) => ({ type: 'global' as const, id: i.id, title: i.title, href: i.href, source: 'GW' as const, subtitle: i.subtitle })),
    ...saItems.map((i) => ({ type: 'global' as const, id: i.id, title: i.title, href: i.href, source: 'SA' as const, subtitle: i.subtitle })),
  ];

  const currentListLength = tab === 'nav' ? filteredNav.length : flatSearchItems.length;

  const handleSelectNav = useCallback(
    (item: NavItem) => {
      router.push(`/${tenantSlug}${item.href}`);
      onOpenChange(false);
    },
    [router, tenantSlug, onOpenChange],
  );

  // ADR-051 §2.6.5: crossapp 이동
  // ITSM 로컬(ticket·kb) → 내부 router.push (기존 보존)
  // GW/SA → window.open(_blank) — NEXT_PUBLIC_GW_URL/NEXT_PUBLIC_SA_URL 사용
  const handleSelectSearch = useCallback(
    (item: FlatSearchItem) => {
      if (item.type === 'ticket') {
        router.push(`/${tenantSlug}/tickets/${item.id}`);
      } else if (item.type === 'kb') {
        router.push(`/${tenantSlug}/kb/${item.id}`);
      } else {
        // global: GW or SA
        const base =
          item.source === 'GW'
            ? (process.env.NEXT_PUBLIC_GW_URL ?? '')
            : (process.env.NEXT_PUBLIC_SA_URL ?? '');
        if (base) {
          window.open(`${base}/${tenantSlug}${item.href}`, '_blank');
        }
        // graceful: base 비어있으면 이동 없음 (proxy 결과지만 env 미설정)
      }
      onOpenChange(false);
    },
    [router, tenantSlug, onOpenChange],
  );

  // SHELL-5 5c: 골격 useKeyboardNav — ↑↓ Enter Esc 상태머신
  // 원 hand-rolled handleKeyDown(ITSM:203~203)을 골격 훅으로 일반화
  const { activeIdx, setActiveIdx, handleKeyDown } = useKeyboardNav({
    listLength: currentListLength,
    // query 변경 시 activeIdx 리셋 — nav↔search 탭 전환 시 두 목록 길이가 같아도
    // 잘못된 항목이 선택되지 않도록 보장 (원 hand-rolled 구현의 query 리셋 동작 보존)
    resetKey: query,
    onSelect: (idx) => {
      if (tab === 'nav') {
        const item = filteredNav[idx];
        if (item) handleSelectNav(item);
      } else {
        const item = flatSearchItems[idx];
        if (item) handleSelectSearch(item);
      }
    },
    onClose: () => onOpenChange(false),
    enabled: open,
  });

  // 검색 디바운스 + race condition 방지
  // ADR-051 §2.6.5: 로컬 ITSM + /api/search/global-proxy(GW+SA) Promise.allSettled 병렬
  // proxy 실패 시 graceful — ITSM 로컬 결과만 표시
  useEffect(() => {
    if (tab !== 'search' || query.trim().length === 0) {
      setResults({ tickets: [], kb: [] });
      setGlobalResults([]);
      setSearching(false);
      setGlobalLoading(false);
      return;
    }

    const q = query.trim();
    const id = ++reqIdRef.current;
    let cancelled = false;

    setSearching(true);
    setGlobalLoading(true);

    const timer = setTimeout(async () => {
      try {
        const [localResult, proxyResult] = await Promise.allSettled([
          // ITSM 로컬 검색 (기존 동작 완전 보존)
          api.get<SearchResult>(`/${tenantSlug}/search`, {
            params: { q, type: 'all', limit: 10 },
          }),
          // GW+SA 글로벌 프록시 (신규, 동일출처 — NEXT_PUBLIC URL 불필요)
          api.get<GlobalProxyResponse>('/api/search/global-proxy', {
            params: { q, limit: 10 },
          }),
        ]);

        if (!cancelled && reqIdRef.current === id) {
          // 로컬 ITSM 결과 (실패 시 graceful 빈 결과)
          if (localResult.status === 'fulfilled') {
            setResults(localResult.value.data);
          } else {
            setResults({ tickets: [], kb: [] });
          }
          // 글로벌 프록시 결과 (실패 시 graceful 빈 배열 — ITSM 로컬만 표시)
          if (proxyResult.status === 'fulfilled') {
            setGlobalResults(proxyResult.value.data.items ?? []);
          } else {
            setGlobalResults([]);
          }
        }
      } finally {
        if (!cancelled && reqIdRef.current === id) {
          setSearching(false);
          setGlobalLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab, tenantSlug]);

  // 전역 단축키 등록 (팔레트 내부 keyDown이 아닌 window 단위는 layout.tsx에서 처리)
  // 이 컴포넌트는 렌더링만, 단축키 토글은 상위(layout)에서 제어

  const isAnyLoading = searching || globalLoading;
  const totalSearchCount = results.tickets.length + results.kb.length + globalResults.length;

  return (
    <CommandPaletteShell open={open} onOpenChange={onOpenChange} zIndex={50}>
      {() => (
      <div
        className="w-full rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: '#1E1E1E',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        {/* 검색 입력 */}
        <div
          className="flex items-center gap-3 px-4 h-14"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Search size={16} className="shrink-0" style={{ color: '#129B8E' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="페이지 이동 또는 검색... (↑↓ 이동, Enter 선택)"
            className="flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: 'rgba(255,255,255,0.9)', caretColor: '#129B8E' }}
            autoComplete="off"
            spellCheck={false}
          />
          {isAnyLoading && (
            <Loader2 size={14} className="shrink-0 animate-spin" style={{ color: '#129B8E' }} />
          )}
          <kbd
            className="hidden sm:inline-flex items-center gap-1 rounded px-1.5 py-0.5"
            style={{
              fontSize: '10px',
              color: 'rgba(255,255,255,0.3)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            esc
          </kbd>
        </div>

        {/* 결과 영역 */}
        <div className="max-h-80 overflow-y-auto p-2">
          {/* NAV 탭 */}
          {tab === 'nav' && (
            <>
              {filteredNav.length === 0 ? (
                <EmptyState message={`"${query}"에 해당하는 페이지가 없습니다`} />
              ) : (
                <ul role="listbox">
                  {filteredNav.map((item, idx) => {
                    const Icon = item.icon;
                    const isActive = idx === activeIdx;
                    return (
                      <li
                        key={item.href}
                        role="option"
                        aria-selected={isActive}
                        onClick={() => handleSelectNav(item)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className="flex items-center gap-2.5 px-2 py-2 rounded-md text-sm cursor-pointer transition-colors"
                        style={{
                          background: isActive ? 'rgba(18, 155, 142,0.12)' : 'transparent',
                        }}
                      >
                        <span
                          className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded"
                          style={{
                            background: isActive ? 'rgba(18, 155, 142,0.2)' : 'rgba(255,255,255,0.06)',
                          }}
                        >
                          <Icon
                            size={13}
                            style={{ color: isActive ? '#129B8E' : 'rgba(255,255,255,0.4)' }}
                          />
                        </span>
                        <span
                          className="text-[10px] uppercase font-semibold tracking-wider w-16 shrink-0"
                          style={{ color: 'rgba(255,255,255,0.3)' }}
                        >
                          {item.section}
                        </span>
                        <span
                          className="flex-1 truncate"
                          style={{ color: isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)' }}
                        >
                          {item.label}
                        </span>
                        {isActive && (
                          <ArrowRight size={12} style={{ color: '#129B8E', flexShrink: 0 }} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {/* 검색 탭 */}
          {tab === 'search' && (
            <>
              {isAnyLoading && totalSearchCount === 0 ? (
                <div className="flex items-center justify-center py-8 gap-2">
                  <Loader2 size={16} className="animate-spin" style={{ color: '#129B8E' }} />
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    검색 중...
                  </span>
                </div>
              ) : totalSearchCount === 0 && !isAnyLoading ? (
                <EmptyState message={`"${query}"에 대한 검색 결과가 없습니다`} />
              ) : (
                <>
                  {/* 티켓 결과 (ITSM 로컬 — 기존 동작 보존) */}
                  {results.tickets.length > 0 && (
                    <Section label="티켓">
                      {results.tickets.map((ticket, idx) => {
                        const globalIdx = idx;
                        const isActive = globalIdx === activeIdx;
                        return (
                          <SearchResultItem
                            key={ticket.id}
                            icon={LifeBuoy}
                            title={ticket.title}
                            badge={ticket.status}
                            isActive={isActive}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onClick={() =>
                              handleSelectSearch({ type: 'ticket', id: ticket.id, title: ticket.title, source: 'ITSM' })
                            }
                          />
                        );
                      })}
                    </Section>
                  )}

                  {/* KB 결과 (ITSM 로컬 — 기존 동작 보존) */}
                  {results.kb.length > 0 && (
                    <Section label="지식베이스">
                      {results.kb.map((kb, idx) => {
                        const globalIdx = results.tickets.length + idx;
                        const isActive = globalIdx === activeIdx;
                        return (
                          <SearchResultItem
                            key={kb.id}
                            icon={FileText}
                            title={kb.title}
                            isActive={isActive}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onClick={() =>
                              handleSelectSearch({ type: 'kb', id: kb.id, title: kb.title, source: 'ITSM' })
                            }
                          />
                        );
                      })}
                    </Section>
                  )}

                  {/* 그룹웨어(GW) 결과 — global-proxy 경유 (ADR-051 §2.6.5) */}
                  {(globalLoading || gwItems.length > 0) && (
                    <Section label="그룹웨어" loading={globalLoading}>
                      {gwItems.map((item, idx) => {
                        const globalIdx = results.tickets.length + results.kb.length + idx;
                        const isActive = globalIdx === activeIdx;
                        return (
                          <SearchResultItem
                            key={`gw-${item.id}`}
                            icon={FileText}
                            title={item.title}
                            subtitle={item.subtitle}
                            sourceBadge="GW"
                            isActive={isActive}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onClick={() =>
                              handleSelectSearch({
                                type: 'global',
                                id: item.id,
                                title: item.title,
                                href: item.href,
                                source: 'GW',
                                subtitle: item.subtitle,
                              })
                            }
                          />
                        );
                      })}
                    </Section>
                  )}

                  {/* SA 워크스페이스 결과 — global-proxy 경유 (ADR-051 §2.6.5) */}
                  {saItems.length > 0 && (
                    <Section label="SA 워크스페이스">
                      {saItems.map((item, idx) => {
                        const globalIdx =
                          results.tickets.length + results.kb.length + gwItems.length + idx;
                        const isActive = globalIdx === activeIdx;
                        return (
                          <SearchResultItem
                            key={`sa-${item.id}`}
                            icon={FileText}
                            title={item.title}
                            subtitle={item.subtitle}
                            sourceBadge="SA"
                            isActive={isActive}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onClick={() =>
                              handleSelectSearch({
                                type: 'global',
                                id: item.id,
                                title: item.title,
                                href: item.href,
                                source: 'SA',
                                subtitle: item.subtitle,
                              })
                            }
                          />
                        );
                      })}
                    </Section>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* 하단 힌트 */}
        <div
          className="flex items-center gap-4 px-4 py-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Hint keys={['↑', '↓']} label="이동" />
          <Hint keys={['Enter']} label="선택" />
          <Hint keys={['Esc']} label="닫기" />
          <span className="ml-auto text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            ⌘K
          </span>
        </div>
      </div>
      )}
    </CommandPaletteShell>
  );
}

// -----------------------------------------------------------------------
// 서브 컴포넌트
// -----------------------------------------------------------------------
function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
      {message}
    </div>
  );
}

function Section({
  label,
  children,
  loading,
}: {
  label: string;
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 px-2 py-1">
        <span
          className="text-[10px] uppercase font-semibold tracking-wider"
          style={{ color: 'rgba(255,255,255,0.3)' }}
        >
          {label}
        </span>
        {loading && (
          <Loader2 size={10} className="animate-spin" style={{ color: 'rgba(255,255,255,0.3)' }} />
        )}
      </div>
      {children}
    </div>
  );
}

interface SearchResultItemProps {
  icon: React.ElementType;
  title: string;
  badge?: string;
  subtitle?: string;
  sourceBadge?: 'GW' | 'SA';
  isActive: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}

function SearchResultItem({
  icon: Icon,
  title,
  badge,
  subtitle,
  sourceBadge,
  isActive,
  onMouseEnter,
  onClick,
}: SearchResultItemProps) {
  return (
    <div
      role="option"
      aria-selected={isActive}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="flex items-center gap-2.5 px-2 py-2 rounded-md text-sm cursor-pointer transition-colors"
      style={{ background: isActive ? 'rgba(18, 155, 142,0.12)' : 'transparent' }}
    >
      <span
        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded"
        style={{
          background: isActive ? 'rgba(18, 155, 142,0.2)' : 'rgba(255,255,255,0.06)',
        }}
      >
        <Icon
          size={13}
          style={{ color: isActive ? '#129B8E' : 'rgba(255,255,255,0.4)' }}
        />
      </span>
      <span
        className="flex-1 truncate"
        style={{ color: isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)' }}
      >
        {title}
      </span>
      {subtitle && (
        <span
          className="shrink-0 truncate max-w-[80px] text-[10px]"
          style={{ color: 'rgba(255,255,255,0.3)' }}
        >
          {subtitle}
        </span>
      )}
      {badge && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.4)',
          }}
        >
          {badge}
        </span>
      )}
      {sourceBadge && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={getSourceBadgeStyle(sourceBadge)}
        >
          {sourceBadge}
        </span>
      )}
      {isActive && (
        <ArrowRight size={12} style={{ color: '#129B8E', flexShrink: 0 }} />
      )}
    </div>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded px-1 py-0.5"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            fontSize: '10px',
          }}
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}
