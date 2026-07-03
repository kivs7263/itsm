import { redirect } from 'next/navigation';

interface PageProps {
  params: { tenantSlug: string };
}

/**
 * RX-1c: /{tenantSlug}/assets → /{tenantSlug}/inventory?tab=assets 리다이렉트
 * 자산·CMDB UI 단일화 — 목록은 /inventory 탭으로 흡수, 상세 페이지(/assets/[assetId])는 유지.
 * 고아 링크 방지(북마크·외부 링크로 /assets 로 들어오는 경우 대비).
 */
export default function AssetsListRedirectPage({ params }: PageProps) {
  redirect(`/${params.tenantSlug}/inventory?tab=assets`);
}
