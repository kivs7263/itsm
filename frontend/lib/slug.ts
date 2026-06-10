import { useParams } from 'next/navigation';

/**
 * useSlug — tenantSlug prefix 헬퍼 훅
 *
 * 모든 내부 링크에서 /{tenantSlug}/... prefix를 보장.
 * 누락 시 Next.js 404 발생 (알려진 패턴).
 *
 * 사용:
 *   const slug = useSlug()
 *   <Link href={slug('/tickets')}>티켓</Link>
 */
export function useSlug() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string | undefined;
  return (path: string) => (tenantSlug ? `/${tenantSlug}${path}` : path);
}

/**
 * prefixPath — 훅 없이 slug prefix를 조합할 때 사용
 * (Server Component나 이벤트 핸들러 내부에서 useSlug 사용 불가한 경우)
 */
export function prefixPath(tenantSlug: string | undefined, path: string): string {
  return tenantSlug ? `/${tenantSlug}${path}` : path;
}

/**
 * getTenantSlugFromPath — window.location.pathname에서 tenantSlug 추출
 * (훅을 쓸 수 없는 유틸 함수에서 사용)
 */
export function getTenantSlugFromPath(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^\/([a-z0-9][a-z0-9-]{2,29})(\/|$)/);
  return match?.[1] ?? '';
}
