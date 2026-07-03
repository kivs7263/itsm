import { redirect } from 'next/navigation';

interface PageProps {
  params: { tenantSlug: string };
}

/**
 * RX-4c: /{tenantSlug}/recurring-alerts → /{tenantSlug}/problems?tab=recurring 리다이렉트
 * 반복 감지 큐는 problems 페이지의 "반복 감지" 탭으로 흡수됨(감지 목록·인지·Problem 생성 전환은
 * problems/page.tsx RecurringTab에 이식). 고아 링크 방지(북마크·딥링크 보존).
 */
export default function RecurringAlertsRedirectPage({ params }: PageProps) {
  redirect(`/${params.tenantSlug}/problems?tab=recurring`);
}
