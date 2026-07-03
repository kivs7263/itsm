import { redirect } from 'next/navigation';

interface PageProps {
  params: { tenantSlug: string };
}

/**
 * /{tenantSlug}/ 루트 → /{tenantSlug}/home 리다이렉트
 * RA-U6: 사이드바 홈(대시보드, /home)과 랜딩을 통일 (구 /tickets 이중 랜딩 제거)
 */
export default function TenantRootPage({ params }: PageProps) {
  redirect(`/${params.tenantSlug}/home`);
}
