'use client';

import { useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import {
  clearAuth,
  isAuthenticated,
  setUser,
  type UserRole,
} from '@/lib/auth';
import { getTenantSlugFromPath } from '@/lib/slug';

// -----------------------------------------------------------------------
// 타입 정의
// -----------------------------------------------------------------------
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar_url?: string | null;
  tenant_id: string;
  organization_name: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

interface AuthMeData {
  user: User;
  tenants: TenantSummary[];
}

interface LoginPayload {
  email: string;
  password: string;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

// -----------------------------------------------------------------------
// Query keys
// -----------------------------------------------------------------------
export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

// -----------------------------------------------------------------------
// slug 헬퍼 — 현재 경로 또는 쿠키에서 tenantSlug 추출
// -----------------------------------------------------------------------
function getSlug(paramsSlug?: string): string {
  if (paramsSlug) return paramsSlug;
  if (typeof window === 'undefined') return '';
  const fromPath = getTenantSlugFromPath();
  if (fromPath) return fromPath;
  // 쿠키 fallback
  const entry = document.cookie
    .split(';')
    .find((c) => c.trim().startsWith('itsm.last.tenant='));
  return entry?.split('=')[1]?.trim() ?? '';
}

// -----------------------------------------------------------------------
// useAuth hook
// -----------------------------------------------------------------------
export function useAuth() {
  const router = useRouter();
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string | undefined;
  const queryClient = useQueryClient();

  // 현재 사용자 정보 — React Query 서버 상태
  const {
    data: meData,
    isLoading,
    isError,
  } = useQuery<AuthMeData | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      if (!isAuthenticated()) return null;
      const response = await api.get<AuthMeData>('/auth/me');
      return response.data;
    },
    enabled: isAuthenticated(),
    staleTime: 5 * 60 * 1000, // 5분
    retry: false,
  });

  const user = meData?.user ?? null;
  const tenants = meData?.tenants ?? [];

  // 로그인
  const loginMutation = useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const response = await api.post<AuthResponse>('/auth/login', payload);
      return response.data;
    },
    onSuccess: async (data) => {
      // 사용자 정보 localStorage 캐시
      setUser({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        tenant_id: data.user.tenant_id,
        organization_name: data.user.organization_name,
        avatar_url: data.user.avatar_url,
      });
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      const fresh = queryClient.getQueryData<AuthMeData | null>(AUTH_QUERY_KEY);
      const realSlug = fresh?.tenants?.[0]?.slug ?? getSlug(tenantSlug);
      router.replace(realSlug ? `/${realSlug}/tickets` : '/tickets');
    },
    onError: (error) => {
      throw error;
    },
  });

  // 로그아웃
  const logout = useCallback(() => {
    clearAuth();
    queryClient.removeQueries({ queryKey: AUTH_QUERY_KEY });
    queryClient.clear();

    // 서버 측 세션 무효화 (fire-and-forget)
    api.post('/auth/logout').catch(() => {
      // 실패해도 클라이언트 로그아웃은 완료됨
    });

    toast.success('로그아웃되었습니다.');
    const slug = getSlug(tenantSlug);
    router.replace(slug ? `/${slug}/login` : '/login');
  }, [queryClient, router, tenantSlug]);

  return {
    user: user ?? null,
    tenants,
    isLoading,
    isError,
    isAuthenticated: !!user,

    // 액션
    login: loginMutation.mutateAsync,
    logout,

    // mutation 상태 (폼에서 사용)
    isLoginPending: loginMutation.isPending,
  };
}

// -----------------------------------------------------------------------
// useCurrentUser — user만 필요한 경우 경량 훅
// -----------------------------------------------------------------------
export function useCurrentUser(): User | null {
  const { data } = useQuery<AuthMeData | null>({
    queryKey: AUTH_QUERY_KEY,
    enabled: false, // useAuth에서 이미 fetch됨, 여기서는 캐시만 읽음
  });
  return data?.user ?? null;
}

export default useAuth;
