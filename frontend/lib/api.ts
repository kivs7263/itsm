/**
 * api.ts — ITSM axios 인스턴스 + 인터셉터
 *
 * 핵심 패턴:
 * - 요청 인터셉터: X-Tenant-Slug 헤더 자동 주입 + CSRF 토큰 주입
 * - 응답 인터셉터: 401 → refresh → 재시도 (mutex)
 * - mutex 패턴: 동시 401 시 refresh 1회만 실행, 나머지 대기
 *   (mutex 없으면 동시 401 → 전원 로그아웃 위험)
 * - 429를 401로 오판 금지: status === 429는 logout 하지 않음
 *
 * 쿠키 prefix: itsm. (GW는 gw.)
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { clearAuth } from './auth';
import { getTenantSlugFromPath } from './slug';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

// -----------------------------------------------------------------------
// 401 redirect 시 slug 포함 login 경로 반환
// -----------------------------------------------------------------------
function getLoginRedirectUrl(): string {
  if (typeof document === 'undefined') return '/login';
  // 쿠키에서 itsm.last.tenant 읽기
  const entry = document.cookie
    .split(';')
    .find((c) => c.trim().startsWith('itsm.last.tenant='));
  const slug = entry?.split('=')[1]?.trim();
  return slug ? `/${slug}/login` : '/login';
}

// -----------------------------------------------------------------------
// axios 인스턴스
// -----------------------------------------------------------------------
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
    'Accept-Language': 'ko-KR',
  },
  timeout: 30_000,
  withCredentials: true, // HttpOnly 쿠키 자동 전송
});

// -----------------------------------------------------------------------
// mutex 상태 (클로저로 모듈 내 공유)
// -----------------------------------------------------------------------
let isRefreshing = false;
let failedQueue: Array<{
  resolve: () => void;
  reject: (reason: unknown) => void;
}> = [];

function processQueue(error: unknown): void {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve();
    }
  });
  failedQueue = [];
}

function getCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return (
    document.cookie
      .split(';')
      .find((c) => c.trim().startsWith('csrf.itsm='))
      ?.split('=')
      .slice(1)
      .join('=')
      .trim() || undefined
  );
}

// -----------------------------------------------------------------------
// 요청 인터셉터: X-Tenant-Slug 헤더 + CSRF 헤더 자동 주입
// -----------------------------------------------------------------------
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // X-Tenant-Slug: URL 경로에서 tenantSlug 추출해 자동 주입
    if (typeof window !== 'undefined' && config.headers) {
      const slug = getTenantSlugFromPath();
      if (slug) {
        config.headers['X-Tenant-Slug'] = slug;
      }
    }

    // CSRF 헤더: 상태 변경 요청에 csrf.itsm 쿠키 값 주입
    const method = (config.method || '').toLowerCase();
    if (
      ['post', 'put', 'patch', 'delete'].includes(method) &&
      typeof document !== 'undefined'
    ) {
      const csrf = getCsrfToken();
      if (csrf && config.headers) {
        config.headers['X-CSRF-Token'] = csrf;
      }
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// -----------------------------------------------------------------------
// 응답 인터셉터: 401 → refresh → 재시도 (mutex)
// -----------------------------------------------------------------------
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // 429는 logout 금지 (rate limit — 401 오판 방지)
    if (error.response?.status === 429) {
      return Promise.reject(error);
    }

    // 401이 아니거나 이미 재시도한 요청은 즉시 reject
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // refresh endpoint 자체가 401인 경우 → 로그아웃
    if (
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/silent-refresh')
    ) {
      clearAuth();
      if (typeof window !== 'undefined') {
        window.location.href = getLoginRedirectUrl();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      // 이미 refresh 진행 중: 대기열 추가
      return new Promise<void>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then(() => api(originalRequest))
        .catch(Promise.reject.bind(Promise));
    }

    isRefreshing = true;

    const csrfHeaders = getCsrfToken()
      ? { 'X-CSRF-Token': getCsrfToken() }
      : {};

    try {
      try {
        // 1단계: itsm.refresh_token 쿠키로 JWT 갱신
        await axios.post(
          `${API_BASE}/auth/refresh`,
          {},
          { withCredentials: true, headers: csrfHeaders },
        );
      } catch {
        // 갱신 토큰 만료 → silent refresh 시도
        await axios.post(
          `${API_BASE}/auth/silent-refresh`,
          {},
          { withCredentials: true, headers: csrfHeaders },
        );
      }
      // 서버가 새 쿠키 발급 완료
      processQueue(null);
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError);
      clearAuth();
      if (typeof window !== 'undefined') {
        window.location.href = getLoginRedirectUrl();
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

// -----------------------------------------------------------------------
// API 헬퍼 타입
// -----------------------------------------------------------------------
export interface PydanticFieldError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface ApiError {
  detail?: string | { code: string; message: string } | PydanticFieldError[];
  message?: string;
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return '네트워크 연결을 확인해주세요.';

    const data = error.response?.data as ApiError | undefined;

    // 422 Pydantic validation: detail 배열
    if (error.response.status === 422 && Array.isArray(data?.detail)) {
      const msgs = (data.detail as PydanticFieldError[])
        .map((e) => {
          const field = e.loc.filter((l) => l !== 'body').join('.');
          return field ? `${field}: ${e.msg}` : e.msg;
        })
        .slice(0, 3)
        .join(', ');
      return msgs || '입력값을 확인해주세요.';
    }

    if (typeof data?.detail === 'string') return data.detail;
    if (
      typeof data?.detail === 'object' &&
      !Array.isArray(data.detail) &&
      (data.detail as { code: string; message: string })?.message
    ) {
      return (data.detail as { code: string; message: string }).message;
    }
    if (data?.message) return data.message;

    if (error.response?.status === 401) return '로그인이 필요합니다.';
    if (error.response?.status === 403) return '접근 권한이 없습니다.';
    if (error.response?.status === 404) return '존재하지 않는 항목입니다.';
    if (error.response?.status && error.response.status >= 500) {
      return '서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
    }
  }
  return '알 수 없는 오류가 발생했습니다.';
}

export function isExpiredTokenError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const data = error.response?.data as ApiError | undefined;
  if (typeof data?.detail === 'object' && !Array.isArray(data.detail)) {
    const detail = data.detail as { code: string; message: string };
    return detail.code === 'token_expired' || detail.code === 'invalid_token';
  }
  return false;
}

export default api;
