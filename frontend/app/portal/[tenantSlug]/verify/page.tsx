'use client';

/**
 * portal/[tenantSlug]/verify/page.tsx — 매직링크 인증 콜백
 *
 * URL: /portal/{tenantSlug}/verify?token=<token>
 * 마운트 시 token 추출 → GET /api/portal/{tenantSlug}/auth/verify
 * 성공: /portal/{tenantSlug} 리다이렉트
 * 실패: 만료/사용됨/토큰없음 각 상황별 실메시지 + 재요청 동선 + 상담원 문의 (IPA-3, 2026-07-07)
 *
 * ⚠️ 백엔드(app/routers/portal_customer.py `/auth/verify`)는 만료/사용됨을 구분하지 않고
 *    단일 401 detail("링크가 만료되었거나 이미 사용되었습니다.")만 반환한다.
 *    프론트에서 임의로 원인을 구분해 보여주지 않는다(근거 없는 단정 금지) — 대신 재요청 CTA를 강화한다.
 *
 * useSearchParams() — Suspense 래핑 필수 (Next.js 14 App Router)
 */

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, AlertCircle, RotateCw } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

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
          setErrorMessage('유효하지 않은 링크입니다. 링크에 인증 정보가 포함되어 있지 않습니다.');
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
            : '링크가 만료되었거나 이미 사용된 링크입니다. 로그인 링크는 발급 후 일정 시간이 지나거나 한 번 사용되면 재사용할 수 없습니다.',
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
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold',
          'text-[#1A1A1A] transition-colors duration-fast',
        )}
        style={{ background: '#129B8E' }}
      >
        <RotateCw size={13} />
        새 로그인 링크 요청
      </a>

      <p className="text-xs text-text-secondary">
        문제가 계속되면 IT 담당자(상담원)에게 문의해주세요.
      </p>
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
