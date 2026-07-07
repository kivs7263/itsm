/**
 * portalLink.ts — 상담원(스태프) 콘솔에서 고객 포털 매직링크를 발급·조합하는 헬퍼.
 *
 * 배경: 고객 포털 접근이 이메일 매직링크 유일 경로라 락아웃 시 구제수단이 없었음.
 * 상담원이 콘솔에서 직접 링크를 발급해 전화·메신저 등 이메일 외 채널로 전달할 수
 * 있게 한다 (최소비용 락아웃 구제).
 *
 * 백엔드: POST /{tenant_slug}/tickets/{ticket_id}/portal-link (staff 인증, router_staff)
 *   실제 마운트: /api/{slug}/tickets/{id}/portal-link (app/main.py:257,
 *   portal_router.router_staff, prefix="/api") — @/lib/api 의 baseURL이 이미
 *   NEXT_PUBLIC_API_BASE(기본 '/api')를 붙이므로 이 파일에서는 '/api' 없이 호출.
 *   응답: { token, expires_at, portal_url }. 티켓에 customer_id 없으면 400.
 *
 * ⚠️ 알려진 불일치 (2026-07-07 발견, 수정 범위 아님 — 프론트 스태프 콘솔 측에서만 보정):
 *   백엔드가 반환하는 portal_url은 `/portal/{token}` 상대경로이지만, 실제 프론트
 *   공개 포털 페이지는 `/portal/magic/[token]` 이다 (ESC-4 백엔드 vs ESC-6 프론트
 *   라우트 命名 불일치 — app/portal/magic/[token]/page.tsx). portal_url 필드를
 *   그대로 붙이면 존재하지 않는 경로가 되어 고객이 열람 시 404가 난다. 따라서
 *   이 헬퍼는 token만 사용해 실제 동작하는 `/portal/magic/{token}` 경로로 직접
 *   조합한다. 백엔드/포털 고객측 파일은 이 작업 범위에서 수정하지 않음 — 근본
 *   수정(portal_url 필드 자체를 고치거나 프론트 라우트를 이동하는 것)은 별도
 *   작업으로 리더/백엔드 담당에게 위임.
 */
import { api } from '@/lib/api';

export interface PortalLinkResult {
  token: string;
  expiresAt: string;
  /** 절대 URL — 클립보드 복사·SMS·메신저 전달용 */
  url: string;
}

interface PortalLinkApiResponse {
  token: string;
  expires_at: string;
  portal_url: string;
}

function portalBaseUrl(): string {
  // cross-app URL env 규약 (frontend/.env.production, 빌드타임 인라인)
  const envBase = process.env.NEXT_PUBLIC_ITSM_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  // 로컬/미설정 환경 폴백: 현재 origin
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

/**
 * 티켓 기준 고객 포털 매직링크를 발급하고 절대 URL로 조합해 반환한다.
 * 실패 시(예: 티켓에 고객 미연결 → 400) 에러를 그대로 throw — 호출부에서
 * getErrorMessage(err)로 토스트 처리.
 */
export async function issuePortalLink(
  tenantSlug: string,
  ticketId: string,
): Promise<PortalLinkResult> {
  const res = await api.post<PortalLinkApiResponse>(
    `/${tenantSlug}/tickets/${ticketId}/portal-link`,
  );
  const { token, expires_at } = res.data;
  return {
    token,
    expiresAt: expires_at,
    url: `${portalBaseUrl()}/portal/magic/${token}`,
  };
}

/** 만료일 한국어 표기 (예: "2026-07-14까지 유효") */
export function formatPortalExpiry(expiresAt: string): string {
  try {
    const d = new Date(expiresAt);
    const label = d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return `${label}까지 유효`;
  } catch {
    return '7일간 유효';
  }
}
