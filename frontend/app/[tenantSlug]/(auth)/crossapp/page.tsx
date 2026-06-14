'use client';

/**
 * Cross-app SSO 콜백 페이지 (ITSM 수신)
 * - URL: /{tenantSlug}/crossapp?token=<one-time-token>
 * - SA Workspace 또는 GW가 발급한 토큰을 받아 ITSM 로그인 처리
 * - 성공: /{tenantSlug}/tickets
 * - 실패: /{tenantSlug}/login?error=crossapp_failed
 *
 * useSearchParams() → 반드시 Suspense 래핑 (Next.js 14 필수)
 */

import React, { Suspense } from 'react';
import { useSearchParams, useRouter, useParams } from 'next/navigation';

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-accent" />
      <p className="text-sm text-text-secondary">앱 전환 중...</p>
    </div>
  );
}

function CrossAppContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string | undefined;

  // StrictMode/Suspense 이중 실행 방지
  const executed = React.useRef(false);

  React.useEffect(() => {
    if (executed.current) return;
    executed.current = true;

    const token = searchParams.get('token');

    if (!token) {
      router.replace(tenantSlug ? `/${tenantSlug}/login` : '/login');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const redeemUrl = tenantSlug
          ? `/api/${tenantSlug}/auth/crossapp/redeem`
          : '/api/auth/crossapp/redeem';
        const res = await fetch(redeemUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          credentials: 'include',
        });

        if (cancelled) return;

        if (!res.ok) {
          router.replace(
            tenantSlug
              ? `/${tenantSlug}/login?error=crossapp_failed`
              : '/login?error=crossapp_failed',
          );
          return;
        }

        // 서버가 HttpOnly 쿠키로 세션 발급 완료
        router.replace(tenantSlug ? `/${tenantSlug}/tickets` : '/tickets');
      } catch {
        if (cancelled) return;
        router.replace(
          tenantSlug
            ? `/${tenantSlug}/login?error=crossapp_failed`
            : '/login?error=crossapp_failed',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, router, tenantSlug]);

  return <Spinner />;
}

export default function CrossAppPage() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Suspense fallback={<Spinner />}>
        <CrossAppContent />
      </Suspense>
    </div>
  );
}
