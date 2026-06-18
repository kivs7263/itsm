/**
 * portal/[tenantSlug]/layout.tsx — 고객 포털 전용 레이아웃
 *
 * 내부 AppShell과 완전 분리:
 * - 별도 쿠키 (itsm_portal_session)
 * - 별도 UI 스타일 (포털 헤더 + 단순 레이아웃)
 * - Sidebar 없음
 * - 미들웨어에서 /portal/ 경로는 itsm.last.tenant 처리 제외
 */

import type { Metadata } from 'next';
import { PortalNav } from './PortalNav';

export const metadata: Metadata = {
  title: {
    template: '%s | ITSM 고객 포털',
    default: 'ITSM 고객 포털',
  },
  description: 'IT 지원 요청 및 티켓 조회 고객 셀프서비스 포털',
};

interface PortalLayoutProps {
  children: React.ReactNode;
  params: { tenantSlug: string };
}

export default function PortalLayout({ children, params }: PortalLayoutProps) {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* 포털 헤더 */}
      <header className="border-b border-border-default bg-surface px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: '#F5C000' }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1A1A1A"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 14.5c0-2.76 2.24-5 5-5s5 2.24 5 5" />
                <rect x="7.5" y="14" width="2" height="3.5" rx="1" />
                <rect x="18.5" y="14" width="2" height="3.5" rx="1" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">IT 지원 포털</p>
              <p className="text-xs text-text-secondary">{params.tenantSlug}</p>
            </div>
          </div>

          {/* 포털 네비게이션 (클라이언트 컴포넌트) */}
          <PortalNav tenantSlug={params.tenantSlug} />
        </div>
      </header>

      {/* 포털 콘텐츠 */}
      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      {/* 포털 푸터 */}
      <footer className="border-t border-border-default py-4 text-center">
        <p className="text-xs text-text-secondary">
          Powered by Alvio ITSM
        </p>
      </footer>
    </div>
  );
}
