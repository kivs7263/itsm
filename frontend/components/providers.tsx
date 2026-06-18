'use client';

/**
 * providers.tsx — 클라이언트 사이드 Provider 묶음
 * layout.tsx는 서버 컴포넌트이므로 'use client' 경계를 별도 파일로 분리
 */

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/lib/locale';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // QueryClient는 useState initializer 패턴으로 인스턴스 1회만 생성
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,       // 1분
            gcTime: 15 * 60 * 1000,     // 15분 (5분 GC 시 재방문마다 스피너 노출)
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </LocaleProvider>
  );
}
