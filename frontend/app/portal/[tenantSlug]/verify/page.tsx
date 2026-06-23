'use client';

/**
 * portal/[tenantSlug]/verify/page.tsx — 매직링크 인증 콜백
 *
 * URL: /portal/{tenantSlug}/verify?token=<token>
 * 마운트 시 token 추출 → POST /api/portal/{tenantSlug}/auth/verify
 * 성공: /portal/{tenantSlug}/tickets 리다이렉트
 * 실패: 에러 메시지 + 로그인 링크
 *
 * useSearchParams() — Suspense 래핑 필수 (Next.js 14 App Router)
 */

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import api from '@/lib/api';

// -----------------------------------------------------------------------
// 실제 검증 로직 — useSearchParams 사용 (Suspense 내부)
// -----------------------------------------------------------------------
function VerifyContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantSlug = params?.tenantSlug as string;
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      // token 없음 → 즉시 에러
      if (!token) {
        if (!cancelled) {
          setErrorMessage('유효하지 않은 링크입니다. 토큰이 없습니다.');
          setStatus('error');
        }
        return;
      }

      try {
        await api.get(`/portal/${tenantSlug}/auth/verify`, { params: { token } });
        if (!cancelled) {
          router.replace(`/portal/${tenantSlug}/tickets`);
        }
      } catch (err: unknown) {
        if (cancelled) return;

        const status =
          err &&
          typeof err === 'object' &&
          'response' in err &&
          err.response &&
          typeof err.response === 'object' &&
          'data' in err.response
            ? (err.response as { data?: { detail?: string } }).data?.detail
            : undefined;

        setErrorMessage(
          typeof status === 'string'
            ? status
            : '링크가 만료되었거나 이미 사용된 링크입니다.',
        );
        setStatus('error');
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  // token, tenantSlug, router는 마운트 시 1회만 실행되도록 eslint 무시
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <Loader2 size={36} className="animate-spin text-text-secondary" />
        <p className="text-sm text-text-secondary">인증 처리 중...</p>
      </div>
    );
  }

  // 에러 상태
  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'rgba(220, 38, 38, 0.10)' }}
      >
        <AlertCircle size={28} className="text-error" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-text-primary">인증 실패</h2>
        <p className="mt-2 text-sm text-text-secondary">{errorMessage}</p>
      </div>
      <a
        href={`/portal/${tenantSlug}/login`}
        className="text-sm font-medium text-accent-500 hover:underline"
      >
        로그인 페이지로 이동
      </a>
    </div>
  );
}

// -----------------------------------------------------------------------
// 페이지 — Suspense 래핑 (useSearchParams 요구사항)
// -----------------------------------------------------------------------
export default function PortalVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-4 py-16">
          <Loader2 size={36} className="animate-spin text-text-secondary" />
          <p className="text-sm text-text-secondary">로딩 중...</p>
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
