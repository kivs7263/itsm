'use client';

/**
 * BusinessContextBar — 앱 상단 사업카드 컨텍스트 필터 바
 *
 * SA 사업카드를 선택하면 localStorage에 active_business_id를 저장 (다중 탭 유지).
 * 티켓 목록 등에서 이 값을 읽어 필터 적용.
 * SA_BACKEND_URL 미설정 or 사업카드 0건 → 자동 숨김.
 */

import * as React from 'react';
import { ChevronDown, Briefcase, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Business {
  id: string;
  name: string;
  status: string;
}

const SESSION_KEY = 'itsm_active_business_id';
const SESSION_NAME_KEY = 'itsm_active_business_name';

export function useActiveBusiness() {
  const [active, setActiveState] = React.useState<{ id: string; name: string } | null>(null);

  React.useEffect(() => {
    const id = localStorage.getItem(SESSION_KEY);
    const name = localStorage.getItem(SESSION_NAME_KEY);
    if (id && name) setActiveState({ id, name });
  }, []);

  const setActive = React.useCallback((id: string, name: string) => {
    localStorage.setItem(SESSION_KEY, id);
    localStorage.setItem(SESSION_NAME_KEY, name);
    setActiveState({ id, name });
    // 다른 탭에서 읽을 수 있도록 storage event 발행 (같은 탭은 안 들림)
    window.dispatchEvent(new CustomEvent('itsm-business-changed', { detail: { id, name } }));
  }, []);

  const clearActive = React.useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_NAME_KEY);
    setActiveState(null);
    window.dispatchEvent(new CustomEvent('itsm-business-changed', { detail: null }));
  }, []);

  return { active, setActive, clearActive };
}

interface BusinessContextBarProps {
  tenantSlug: string;
}

export function BusinessContextBar({ tenantSlug }: BusinessContextBarProps) {
  const [open, setOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const { active, setActive, clearActive } = useActiveBusiness();

  const { data: businesses = [] } = useQuery<Business[]>({
    queryKey: ['businesses', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/businesses`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // 드롭다운 외부 클릭 닫기 — 조건부 return 전에 선언
  React.useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  // 0건이면 렌더 안 함 (hooks는 모두 위에서 호출됨)
  if (!businesses.length) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-surface-elevated shrink-0">
      <Briefcase size={13} className="text-text-secondary shrink-0" />
      <span className="text-xs text-text-secondary">현재 사업</span>

      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
            'border border-border-default bg-surface hover:bg-surface-hover transition-colors',
            active ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          <span className="max-w-[200px] truncate">
            {active?.name ?? '전체 보기'}
          </span>
          <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[240px] max-h-64 overflow-y-auto rounded-lg border border-border-strong bg-surface-elevated shadow-lg py-1">
            <button
              type="button"
              onClick={() => { clearActive(); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors',
                !active && 'font-medium text-brand',
              )}
            >
              전체 보기
            </button>
            <div className="my-1 h-px bg-border-subtle" />
            {businesses.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => { setActive(b.id, b.name); setOpen(false); }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors truncate',
                  active?.id === b.id && 'font-medium text-brand',
                )}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <button
          type="button"
          onClick={clearActive}
          className="text-text-disabled hover:text-text-secondary transition-colors"
          aria-label="필터 해제"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
