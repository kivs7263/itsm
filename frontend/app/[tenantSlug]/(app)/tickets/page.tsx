import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '티켓',
};

/**
 * 티켓 목록 페이지 — P1-3 플레이스홀더
 * Phase 2에서 티켓 CRUD·필터·SLA 뱃지 구현 예정
 */
export default function TicketsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 text-text-secondary">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(245, 192, 0, 0.12)' }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#F5C000"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-text-primary">티켓 모듈 준비 중</p>
        <p className="mt-1 text-sm text-text-secondary">
          Phase 2에서 티켓 생성·조회·SLA 관리 기능이 추가됩니다.
        </p>
      </div>
    </div>
  );
}
