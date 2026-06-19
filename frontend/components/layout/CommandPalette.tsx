'use client';

/**
 * CommandPalette — ITSM Cmd+K / Ctrl+K 팔레트 (ELEVATE-1 P1-4-A)
 *
 * - cmdk 라이브러리 미사용, native React 구현
 * - ⌘K / Ctrl+K 토글, Esc 닫기, ↑↓ 이동, Enter 선택
 * - 탭 1: NAV (Sidebar 라우트 미러), 탭 2: 콘텐츠 검색 (unified_search API)
 * - 검색 디바운스 300ms, race condition → cancelled flag
 * - hooks: 모두 조건부 return 이전 선언 ("Rendered more hooks" 방지)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
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

const NAV_ITEMS: NavItem[] = [
  { section: '대시보드',   label: '홈',           href: '/home',             icon: Home      },
  { section: '티켓',       label: '티켓 목록',    href: '/tickets',          icon: LifeBuoy  },
  { section: '티켓',       label: '작업 로그',    href: '/work-logs',        icon: Clock     },
  { section: '고객',       label: '고객 목록',    href: '/customers',        icon: Users     },
  { section: '지식베이스', label: '지식베이스',   href: '/kb',               icon: BookOpen  },
  { section: '운영',       label: '반복 장애',    href: '/recurring-alerts', icon: RefreshCw },
  { section: '보고서',     label: '보고서',       href: '/reports',          icon: BarChart2 },
  { section: '설정',       label: '설정',         href: '/settings',         icon: Settings  },
];

// -----------------------------------------------------------------------
// 검색 API 응답 타입
// GET /{tenant_slug}/search?q=...&type=all&limit=20
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
// CommandPaletteProps
// -----------------------------------------------------------------------
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string;
}

// -----------------------------------------------------------------------
// CommandPalette
// -----------------------------------------------------------------------
export function CommandPalette({ open, onOpenChange, tenantSlug }: CommandPaletteProps) {
  const router = useRouter();

  // 탭: 'nav' | 'search'
  const [tab, setTab] = useState<'nav' | 'search'>('nav');
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  // 검색 결과 상태
  const [results, setResults] = useState<SearchResult>({ tickets: [], kb: [] });
  const [searching, setSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // race condition 방지 — 최신 요청 ID
  const reqIdRef = useRef(0);

  // open 시 상태 초기화 + 포커스
  useEffect(() => {
    if (open) {
      setTab('nav');
      setQuery('');
      setActiveIdx(0);
      setResults({ tickets: [], kb: [] });
      setSearching(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // query 변경 시 activeIdx 리셋
  useEffect(() => {
    setActiveIdx(0);
  }, [query, tab]);

  // 탭 자동 전환: query 입력 시 search 탭으로
  useEffect(() => {
    if (query.trim().length > 0) {
      setTab('search');
    } else {
      setTab('nav');
    }
  }, [query]);

  // 검색 디바운스 + race condition 방지
  useEffect(() => {
    if (tab !== 'search' || query.trim().length === 0) {
      setResults({ tickets: [], kb: [] });
      setSearching(false);
      return;
    }

    const q = query.trim();
    const id = ++reqIdRef.current;
    let cancelled = false;

    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const resp = await api.get<SearchResult>(`/${tenantSlug}/search`, {
          params: { q, type: 'all', limit: 10 },
        });
        if (!cancelled && reqIdRef.current === id) {
          setResults(resp.data);
        }
      } catch {
        if (!cancelled && reqIdRef.current === id) {
          setResults({ tickets: [], kb: [] });
        }
      } finally {
        if (!cancelled && reqIdRef.current === id) {
          setSearching(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab, tenantSlug]);

  // nav 탭 필터링
  const filteredNav = query.trim()
    ? NAV_ITEMS.filter(
        (it) =>
          it.label.toLowerCase().includes(query.toLowerCase()) ||
          it.section.toLowerCase().includes(query.toLowerCase()),
      )
    : NAV_ITEMS;

  // 검색 탭 플랫 항목 (↑↓ 이동용)
  const flatSearchItems: Array<{ type: 'ticket' | 'kb'; id: string; title: string }> = [
    ...results.tickets.map((t) => ({ type: 'ticket' as const, id: t.id, title: t.title })),
    ...results.kb.map((k) => ({ type: 'kb' as const, id: k.id, title: k.title })),
  ];

  const handleSelectNav = useCallback(
    (item: NavItem) => {
      router.push(`/${tenantSlug}${item.href}`);
      onOpenChange(false);
    },
    [router, tenantSlug, onOpenChange],
  );

  const handleSelectSearch = useCallback(
    (item: { type: 'ticket' | 'kb'; id: string }) => {
      if (item.type === 'ticket') {
        router.push(`/${tenantSlug}/tickets/${item.id}`);
      } else {
        router.push(`/${tenantSlug}/kb/${item.id}`);
      }
      onOpenChange(false);
    },
    [router, tenantSlug, onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const listLength = tab === 'nav' ? filteredNav.length : flatSearchItems.length;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, listLength - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (tab === 'nav') {
          const item = filteredNav[activeIdx];
          if (item) handleSelectNav(item);
        } else {
          const item = flatSearchItems[activeIdx];
          if (item) handleSelectSearch(item);
        }
      } else if (e.key === 'Escape') {
        onOpenChange(false);
      }
    },
    [tab, filteredNav, flatSearchItems, activeIdx, handleSelectNav, handleSelectSearch, onOpenChange],
  );

  // 전역 단축키 등록 (팔레트 내부 keyDown이 아닌 window 단위는 layout.tsx에서 처리)
  // 이 컴포넌트는 렌더링만, 단축키 토글은 상위(layout)에서 제어

  if (!open) return null;

  const totalSearchCount = results.tickets.length + results.kb.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-modal="true"
      aria-label="명령 팔레트"
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: '#1E1E1E',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 검색 입력 */}
        <div
          className="flex items-center gap-3 px-4 h-14"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Search size={16} className="shrink-0" style={{ color: '#F5C000' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="페이지 이동 또는 검색... (↑↓ 이동, Enter 선택)"
            className="flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: 'rgba(255,255,255,0.9)', caretColor: '#F5C000' }}
            autoComplete="off"
            spellCheck={false}
          />
          {searching && (
            <Loader2 size={14} className="shrink-0 animate-spin" style={{ color: '#F5C000' }} />
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
                          background: isActive ? 'rgba(245,192,0,0.12)' : 'transparent',
                        }}
                      >
                        <span
                          className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded"
                          style={{
                            background: isActive ? 'rgba(245,192,0,0.2)' : 'rgba(255,255,255,0.06)',
                          }}
                        >
                          <Icon
                            size={13}
                            style={{ color: isActive ? '#F5C000' : 'rgba(255,255,255,0.4)' }}
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
                          <ArrowRight size={12} style={{ color: '#F5C000', flexShrink: 0 }} />
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
              {searching && totalSearchCount === 0 ? (
                <div className="flex items-center justify-center py-8 gap-2">
                  <Loader2 size={16} className="animate-spin" style={{ color: '#F5C000' }} />
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    검색 중...
                  </span>
                </div>
              ) : totalSearchCount === 0 && !searching ? (
                <EmptyState message={`"${query}"에 대한 검색 결과가 없습니다`} />
              ) : (
                <>
                  {/* 티켓 결과 */}
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
                            onClick={() => handleSelectSearch({ type: 'ticket', id: ticket.id })}
                          />
                        );
                      })}
                    </Section>
                  )}

                  {/* KB 결과 */}
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
                            onClick={() => handleSelectSearch({ type: 'kb', id: kb.id })}
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
    </div>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div
        className="px-2 py-1 text-[10px] uppercase font-semibold tracking-wider"
        style={{ color: 'rgba(255,255,255,0.3)' }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

interface SearchResultItemProps {
  icon: React.ElementType;
  title: string;
  badge?: string;
  isActive: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}

function SearchResultItem({
  icon: Icon,
  title,
  badge,
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
      style={{ background: isActive ? 'rgba(245,192,0,0.12)' : 'transparent' }}
    >
      <span
        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded"
        style={{
          background: isActive ? 'rgba(245,192,0,0.2)' : 'rgba(255,255,255,0.06)',
        }}
      >
        <Icon
          size={13}
          style={{ color: isActive ? '#F5C000' : 'rgba(255,255,255,0.4)' }}
        />
      </span>
      <span
        className="flex-1 truncate"
        style={{ color: isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)' }}
      >
        {title}
      </span>
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
      {isActive && (
        <ArrowRight size={12} style={{ color: '#F5C000', flexShrink: 0 }} />
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
