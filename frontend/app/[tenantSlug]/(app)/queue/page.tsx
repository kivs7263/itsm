import { redirect } from 'next/navigation';

interface PageProps {
  params: { tenantSlug: string };
}

/**
 * RX-4c: /{tenantSlug}/queue → /{tenantSlug}/tickets?view=pool 리다이렉트
 * 티켓 풀(미배정 큐)은 tickets 페이지의 "티켓 풀" 탭으로 흡수됨(claim·assign·SELECT FOR UPDATE
 * 락 UX는 tickets/page.tsx QueueTab에 이식). 고아 링크 방지(북마크·딥링크 보존).
 */
export default function QueueRedirectPage({ params }: PageProps) {
  redirect(`/${params.tenantSlug}/tickets?view=pool`);
}
