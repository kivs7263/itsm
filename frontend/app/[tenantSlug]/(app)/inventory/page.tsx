'use client';

// -----------------------------------------------------------------------
// /inventory — RX-1c: 자산(assets) + CMDB(cmdb) UI 단일화
//
// DB 저장소는 분리 유지(Asset/ConfigurationItem, asset_id FK로 연결)하되
// UI 진입점은 "인프라" 단일 항목으로 통합. 탭: 자산 목록 / 구성항목(CI) / 관계맵.
// 기존 /assets, /cmdb 목록 경로는 이 페이지로 리다이렉트(고아 링크 방지).
// 상세 페이지(/assets/[assetId], /cmdb/[ciId])는 기존 경로 그대로 유지.
// -----------------------------------------------------------------------

import React, { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Boxes, Server, Waypoints, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetsListView } from '@/components/inventory/AssetsListView';
import { CIListView } from '@/components/inventory/CIListView';
import { RelationshipMapView } from '@/components/inventory/RelationshipMapView';
import { DiscoveryView } from '@/components/inventory/DiscoveryView';

type TabKey = 'assets' | 'cis' | 'map' | 'discovery';

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'assets',    label: '자산 목록',       icon: Boxes     },
  { key: 'cis',       label: '구성항목(CI)',    icon: Server    },
  { key: 'map',       label: '관계맵',          icon: Waypoints },
  { key: 'discovery', label: '디스커버리',      icon: Radar     },
];

function isTabKey(v: string | null): v is TabKey {
  return v === 'assets' || v === 'cis' || v === 'map' || v === 'discovery';
}

function InventoryPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : 'assets';

  const setTab = useCallback(
    (key: TabKey) => {
      const qs = new URLSearchParams(searchParams.toString());
      qs.set('tab', key);
      router.push(`${pathname}?${qs.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const content = useMemo(() => {
    if (activeTab === 'cis') return <CIListView />;
    if (activeTab === 'map') return <RelationshipMapView />;
    if (activeTab === 'discovery') return <DiscoveryView />;
    return <AssetsListView />;
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="v2-page-title text-text-primary">인프라</h1>
      </div>

      {/* 탭 바 */}
      <div className="flex border-b border-border-subtle bg-surface shrink-0 px-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors',
              activeTab === key
                ? 'border-brand text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 min-h-0">{content}</div>
    </div>
  );
}

export default function InventoryPage() {
  // useSearchParams는 Suspense 경계 필요 (Next.js App Router 규칙)
  return (
    <Suspense fallback={null}>
      <InventoryPageInner />
    </Suspense>
  );
}
