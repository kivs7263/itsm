'use client';

/**
 * hooks/usePortalAuth.ts — 포털 세션 관리
 *
 * 포털 전용 쿠키(itsm_portal_session)는 백엔드가 관리.
 * TanStack Query로 GET /api/portal/{tenantSlug}/me 호출.
 * 401 → { user: null } 반환 (throw 금지 — 미인증 상태를 정상값으로 처리)
 */

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  company?: string;
}

interface PortalMeResponse {
  id: string;
  name: string;
  email: string;
  company?: string;
}

export function usePortalAuth(tenantSlug: string) {
  const {
    data: user,
    isLoading,
    isError,
  } = useQuery<PortalUser | null>({
    queryKey: ['portal-me', tenantSlug],
    queryFn: async (): Promise<PortalUser | null> => {
      try {
        const response = await api.get<PortalMeResponse>(
          `/portal/${tenantSlug}/me`,
        );
        return response.data;
      } catch (err: unknown) {
        // 401 → 미인증 상태 (정상 처리, throw 금지)
        const status =
          err &&
          typeof err === 'object' &&
          'response' in err &&
          err.response &&
          typeof err.response === 'object' &&
          'status' in err.response
            ? (err.response as { status: number }).status
            : undefined;

        if (status === 401) return null;
        throw err;
      }
    },
    enabled: !!tenantSlug,
    staleTime: 5 * 60 * 1000, // 5분
    retry: false, // 401에서 재시도 금지
  });

  return {
    user: user ?? null,
    isLoading,
    isError,
  };
}
