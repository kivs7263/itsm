'use client';

/**
 * 루트 페이지 — itsm.last.tenant 쿠키에서 slug 읽어 리다이렉트
 * 쿠키 없으면 /login으로 이동 (slug 없는 fallback)
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    // itsm.last.tenant 쿠키에서 마지막 접속 slug 읽기
    const entry = document.cookie
      .split(';')
      .find((c) => c.trim().startsWith('itsm.last.tenant='));
    const slug = entry?.split('=')[1]?.trim();

    if (slug) {
      router.replace(`/${slug}/tickets`);
    } else {
      // slug 없으면 기본 조직 로그인 페이지로
      router.replace('/xiilab/login');
    }
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-accent" />
    </div>
  );
}
