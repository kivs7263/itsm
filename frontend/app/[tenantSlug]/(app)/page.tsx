import { redirect } from 'next/navigation';

interface PageProps {
  params: { tenantSlug: string };
}

/**
 * /{tenantSlug}/ 루트 → /{tenantSlug}/tickets 리다이렉트
 */
export default function TenantRootPage({ params }: PageProps) {
  redirect(`/${params.tenantSlug}/tickets`);
}
