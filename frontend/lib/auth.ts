/**
 * auth.ts — ITSM 토큰 관리 헬퍼
 *
 * SSR guard: typeof window === 'undefined' 체크 필수
 * 역할 판별 로직은 모두 이 파일에서 중앙화 — 인라인 중복 금지
 *
 * 쿠키 prefix: itsm. (GW는 gw.)
 */

export type UserRole = 'engineer' | 'team_lead' | 'admin' | 'customer';

// -----------------------------------------------------------------------
// 인증 상태 확인 (쿠키 기반)
// -----------------------------------------------------------------------

/**
 * isAuthenticated — csrf.itsm 쿠키 존재 여부로 인증 판별
 * HttpOnly 쿠키(itsm.access_token)는 JS에서 읽을 수 없으므로
 * non-HttpOnly CSRF 쿠키를 sentinel로 사용
 */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith('csrf.itsm='));
}

// -----------------------------------------------------------------------
// 사용자 정보 (localStorage)
// -----------------------------------------------------------------------

const USER_KEY = 'itsm.auth.user';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenant_id: string;
  organization_name: string;
  avatar_url?: string | null;
}

export function getUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setUser(user: StoredUser): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// -----------------------------------------------------------------------
// 정리 (로그아웃 시 호출)
// -----------------------------------------------------------------------

/**
 * clearAuth — ITSM 인증 관련 localStorage 항목 정리
 * HttpOnly 쿠키(itsm.access_token, itsm.refresh_token)는 서버 /auth/logout이 삭제
 */
export function clearAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_KEY);
}

// -----------------------------------------------------------------------
// 역할 판별 헬퍼 — 인라인 중복 금지, 반드시 이 함수들 사용
// -----------------------------------------------------------------------

export function isAdminRole(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function isTeamLead(role: UserRole | undefined): boolean {
  return role === 'team_lead';
}

export function isTeamLeadOrAbove(role: UserRole | undefined): boolean {
  return role === 'team_lead' || role === 'admin';
}

export function isEngineerOrAbove(role: UserRole | undefined): boolean {
  return role === 'engineer' || role === 'team_lead' || role === 'admin';
}

export function isCustomer(role: UserRole | undefined): boolean {
  return role === 'customer';
}

export function canManageTickets(role: UserRole | undefined): boolean {
  return isEngineerOrAbove(role);
}

export function canManageTeam(role: UserRole | undefined): boolean {
  return isTeamLeadOrAbove(role);
}

export function canAccessAdmin(role: UserRole | undefined): boolean {
  return isAdminRole(role);
}
