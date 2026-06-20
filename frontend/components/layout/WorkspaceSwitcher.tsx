'use client';

/**
 * WorkspaceSwitcher.tsx — ITSM thin wrapper
 *
 * 데이터 준비(fetch /api/me/products, crossapp/issue, env URL, useAuth)는 여기서.
 * 렌더는 @total/ui-shell AppSwitcher에 위임.
 *
 * 4앱 그리드 (3열):
 *   - ITSM (현재): 브랜드 색 강조 + 활성 표시
 *   - GW (Groupware): crossapp/issue → crossapp?token= 리다이렉트
 *   - SA (SA Workspace): crossapp/issue → crossapp?token= 리다이렉트
 *   - Admin Portal: 새 탭으로 열기
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  LayoutDashboard,
  ShieldCheck,
  LifeBuoy,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { AppSwitcher, type AppItem } from '@total/ui-shell';
import { useAuth } from '@/hooks/useAuth';

interface ProductEntry {
  slug: string
  name: string
  subscribed: boolean
  isRequired: boolean
}

// API 실패 시 fallback: 모두 표시
const FALLBACK_SUBSCRIBED = new Set(['sa-workspace', 'groupware', 'itsm']);

const SA_URL           = process.env.NEXT_PUBLIC_SA_URL           || undefined;
const GW_URL           = process.env.NEXT_PUBLIC_GW_URL           || undefined;
const ADMIN_PORTAL_URL = process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL || undefined;

interface WorkspaceSwitcherProps {
  collapsed: boolean;
}

export function WorkspaceSwitcher({ collapsed }: WorkspaceSwitcherProps) {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string | undefined;
  const { user } = useAuth();

  const orgName = user?.organization_name ?? '내 조직';
  // ITSM User 타입에 logo_url 미포함 — 로고 없이 AlvioHexLogo 표시
  const logoUrl: string | null = null;

  // /api/me/products — 구독 중인 제품 slug 집합
  const [subscribedSlugs, setSubscribedSlugs] = useState<Set<string>>(FALLBACK_SUBSCRIBED);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me/products', { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ProductEntry[];
        const set = new Set(data.filter((p) => p.subscribed).map((p) => p.slug));
        if (!cancelled && set.size > 0) setSubscribedSlugs(set);
      })
      .catch(() => {/* fallback 유지 */});
    return () => { cancelled = true; };
  }, []);

  const handleSwitchToSA = useCallback(async () => {
    if (!SA_URL) return;
    try {
      const issueUrl = tenantSlug
        ? `/api/${tenantSlug}/auth/crossapp/issue`
        : '/api/auth/crossapp/issue';
      const res = await fetch(issueUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const target = tenantSlug
          ? `${SA_URL}/${tenantSlug}/auth/crossapp?token=${data.token}`
          : `${SA_URL}/auth/crossapp?token=${data.token}`;
        window.location.href = target;
      } else {
        window.location.href = tenantSlug
          ? `${SA_URL}/${tenantSlug}/compass`
          : SA_URL;
      }
    } catch {
      window.location.href = tenantSlug ? `${SA_URL}/${tenantSlug}/compass` : SA_URL!;
    }
  }, [tenantSlug]);

  const handleSwitchToGW = useCallback(async () => {
    if (!GW_URL) return;
    try {
      const issueUrl = tenantSlug
        ? `/api/${tenantSlug}/auth/crossapp/issue`
        : '/api/auth/crossapp/issue';
      const res = await fetch(issueUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const target = tenantSlug
          ? `${GW_URL}/${tenantSlug}/crossapp?token=${data.token}`
          : `${GW_URL}/crossapp?token=${data.token}`;
        window.location.href = target;
      } else {
        window.location.href = tenantSlug ? `${GW_URL}/${tenantSlug}/home` : GW_URL;
      }
    } catch {
      window.location.href = tenantSlug ? `${GW_URL}/${tenantSlug}/home` : GW_URL!;
    }
  }, [tenantSlug]);

  const allApps: AppItem[] = [
    {
      key: 'itsm',
      label: 'ITSM',
      description: '티켓 · 고객 · 지식베이스',
      accentColor: '#129B8E',
      icon: <LifeBuoy size={17} />,
      current: true,
      onSelect: undefined,
    },
    {
      key: 'gw',
      label: 'Groupware',
      description: '결재 · 근태 · 자원 · 포털',
      accentColor: '#C9842A',
      icon: <Building2 size={17} />,
      current: false,
      onSelect: GW_URL ? handleSwitchToGW : undefined,
    },
    {
      key: 'sa',
      label: 'SA Workspace',
      description: '전략 · 성과 · 사업',
      accentColor: '#6E63E6',
      icon: <LayoutDashboard size={17} />,
      current: false,
      onSelect: SA_URL ? handleSwitchToSA : undefined,
    },
    ...(ADMIN_PORTAL_URL ? [{
      key: 'admin',
      label: 'Admin Portal',
      description: '조직 · 제품 · 권한',
      accentColor: '#667085',
      icon: <ShieldCheck size={17} />,
      current: false,
      onSelect: () => window.open(ADMIN_PORTAL_URL, '_blank', 'noopener'),
    }] : []),
  ];

  const slugMap: Record<string, string> = {
    gw: 'groupware',
    sa: 'sa-workspace',
    admin: 'admin',
  };
  const apps = allApps.filter(
    (app) => app.current || subscribedSlugs.has(slugMap[app.key] ?? app.key)
  );

  return (
    <AppSwitcher
      collapsed={collapsed}
      orgName={orgName}
      logoUrl={logoUrl}
      apps={apps}
      subtitle="Alvio ITSM"
      orgIcon={<LifeBuoy size={14} color="#1A1A1A" />}
    />
  );
}
