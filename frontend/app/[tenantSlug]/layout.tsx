/**
 * [tenantSlug]/layout.tsx — tenantSlug 파라미터 전달 레이아웃
 * 하위 (auth) 및 (app) 그룹에 slug 컨텍스트를 제공
 */

interface TenantLayoutProps {
  children: React.ReactNode;
  params: { tenantSlug: string };
}

export default function TenantLayout({ children }: TenantLayoutProps) {
  return <>{children}</>;
}
