/**
 * portal/[tenantSlug]/page.tsx — 포털 홈
 * /portal/{tenantSlug}/tickets 로 즉시 리다이렉트
 */

import { redirect } from 'next/navigation';

interface PortalHomeProps {
  params: { tenantSlug: string };
}

export default function PortalHomePage({ params }: PortalHomeProps) {
  redirect(`/portal/${params.tenantSlug}/tickets`);
}
