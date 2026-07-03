'use client';

// -----------------------------------------------------------------------
// RelationshipMapView — RX-1c: CI 관계맵 탭 (신규)
//
// 새 백엔드 엔드포인트 없이 기존 CMDB API만 재사용:
//   GET /{tenant}/cmdb/cis            — 중심 CI 선택용 목록
//   GET /{tenant}/cmdb/cis/{id}       — 선택된 CI + relationships (기존 상세 페이지와 동일 응답)
//
// 그래프 라이브러리 의존성 없이 "허브(중심 CI) + 스포크(관계)" 카드 레이아웃으로
// 나가는 관계(out)/들어오는 관계(in)를 시각화. 관계 카드 클릭 시 해당 CI를 새 중심으로 재탐색.
// -----------------------------------------------------------------------

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Server, Search, Waypoints } from 'lucide-react';
import { api } from '@/lib/api';
import type { CI, CIsResponse, CIDetailResponse, CIRelationship, CIType, CIStatus, RelType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const CI_TYPE_LABELS: Record<CIType, string> = {
  server: '서버',
  workstation: '워크스테이션',
  network_device: '네트워크',
  application: '애플리케이션',
  service: '서비스',
  database: '데이터베이스',
  virtual_machine: '가상머신',
  cloud_resource: '클라우드',
  storage: '스토리지',
  firewall: '방화벽',
  router_switch: '라우터/스위치',
  printer: '프린터',
};

const CI_STATUS_STYLES: Record<CIStatus, string> = {
  active:           'bg-success-bg text-success-text',
  inactive:         'bg-neutral-100 text-neutral-500',
  maintenance:      'bg-warning-bg text-warning-text',
  decommissioned:   'bg-error-bg text-error-text',
};

const CI_STATUS_LABELS: Record<CIStatus, string> = {
  active:         '운영중',
  inactive:       '비활성',
  maintenance:    '유지보수',
  decommissioned: '폐기',
};

const REL_TYPE_LABELS: Record<RelType, string> = {
  depends_on:   '의존',
  hosted_on:    '호스팅됨',
  runs_on:      '실행됨',
  connects_to:  '연결됨',
  part_of:      '구성요소',
  manages:      '관리',
  backed_up_to: '백업됨',
};

function CIStatusBadge({ status }: { status: CIStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', CI_STATUS_STYLES[status])}>
      {CI_STATUS_LABELS[status]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 스포크 노드 카드
// -----------------------------------------------------------------------
function RelatedCICard({
  rel,
  onSelect,
}: {
  rel: CIRelationship;
  onSelect: (ciId: string) => void;
}) {
  const isOut = rel.direction === 'out';
  const relatedName = typeof rel.related_ci?.name === 'string' ? rel.related_ci.name : '-';
  return (
    <button
      type="button"
      onClick={() => rel.related_ci?.id && onSelect(rel.related_ci.id)}
      className="flex items-center gap-2 w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-left hover:bg-surface-hover hover:border-border-strong transition-colors"
    >
      {isOut ? (
        <ArrowRight size={14} className="shrink-0 text-blue-600" />
      ) : (
        <ArrowLeft size={14} className="shrink-0 text-purple-600" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary truncate">{relatedName}</p>
        <p className="text-[11px] text-text-secondary">
          {REL_TYPE_LABELS[rel.rel_type] ?? rel.rel_type}
        </p>
      </div>
    </button>
  );
}

// -----------------------------------------------------------------------
// 관계맵 뷰 (인프라 탭 콘텐츠)
// -----------------------------------------------------------------------
export function RelationshipMapView() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;

  const [search, setSearch] = useState('');
  const [centerId, setCenterId] = useState<string | null>(null);

  // CI 선택 목록 (검색 가능)
  const { data: listData, isLoading: listLoading } = useQuery<CIsResponse>({
    queryKey: ['cmdb-cis-picker', tenantSlug, search],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/cmdb/cis`, { params: { search: search || undefined, page_size: 30 } })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });
  const ciOptions: CI[] = listData?.items ?? [];

  // 최초 진입 시 첫 CI를 중심으로 자동 선택
  React.useEffect(() => {
    if (!centerId && ciOptions.length > 0) {
      setCenterId(ciOptions[0].id);
    }
  }, [centerId, ciOptions]);

  // 중심 CI 상세 + 관계
  const { data: detail, isLoading: detailLoading, isError } = useQuery<CIDetailResponse>({
    queryKey: ['cmdb-ci-detail', tenantSlug, centerId],
    queryFn: () => api.get(`/${tenantSlug}/cmdb/cis/${centerId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!centerId,
  });

  const ci = detail?.ci ?? null;
  const relationships: CIRelationship[] = Array.isArray(detail?.relationships) ? detail.relationships : [];
  const outRels = relationships.filter((r) => r.direction === 'out');
  const inRels = relationships.filter((r) => r.direction === 'in');

  return (
    <div className="flex h-full">
      {/* 좌측: CI 선택 사이드 목록 */}
      <div className="w-64 shrink-0 border-r border-border-subtle flex flex-col">
        <div className="p-3 border-b border-border-subtle">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="중심 CI 검색..."
              className="h-8 pl-7 pr-2 w-full rounded-md border border-border-default bg-surface text-xs text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-1.5">
          {listLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : ciOptions.length === 0 ? (
            <p className="text-xs text-text-secondary p-3">CI가 없습니다.</p>
          ) : (
            ciOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCenterId(c.id)}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-md text-xs mb-0.5 transition-colors',
                  c.id === centerId
                    ? 'bg-brand/10 text-text-primary font-medium'
                    : 'text-text-secondary hover:bg-surface-hover',
                )}
              >
                <span className="truncate block">{c.name}</span>
                <span className="text-[10px] text-text-disabled">{CI_TYPE_LABELS[c.ci_type] ?? c.ci_type}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 우측: 허브(중심 CI) + 스포크(관계) */}
      <div className="flex-1 overflow-auto p-6">
        {!centerId || detailLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-secondary text-sm">
            {detailLoading ? '불러오는 중...' : 'CI를 선택하세요.'}
          </div>
        ) : isError || !ci ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-secondary text-sm">
            CI 정보를 불러오지 못했습니다.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6 items-start">
            {/* 들어오는 관계 (좌) */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-text-secondary mb-1">
                ← 들어오는 관계 ({inRels.length})
              </p>
              {inRels.length === 0 ? (
                <p className="text-xs text-text-disabled">없음</p>
              ) : (
                inRels.map((rel) => (
                  <RelatedCICard key={rel.id} rel={rel} onSelect={setCenterId} />
                ))
              )}
            </div>

            {/* 허브: 중심 CI */}
            <div className="flex flex-col items-center">
              <div className="w-full rounded-2xl border-2 p-4 flex flex-col items-center gap-2 text-center"
                style={{ borderColor: 'var(--color-brand, #129B8E)', background: 'rgba(18, 155, 142, 0.06)' }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(18, 155, 142, 0.15)' }}
                >
                  <Server size={18} style={{ color: '#129B8E' }} />
                </div>
                <p className="text-sm font-semibold text-text-primary truncate max-w-full">{ci.name}</p>
                <p className="text-xs text-text-secondary">{CI_TYPE_LABELS[ci.ci_type] ?? ci.ci_type}</p>
                <CIStatusBadge status={ci.status} />
              </div>
              <div className="mt-3 flex items-center gap-1 text-[11px] text-text-disabled">
                <Waypoints size={12} />
                관계 총 {relationships.length}건
              </div>
            </div>

            {/* 나가는 관계 (우) */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-text-secondary mb-1">
                나가는 관계 → ({outRels.length})
              </p>
              {outRels.length === 0 ? (
                <p className="text-xs text-text-disabled">없음</p>
              ) : (
                outRels.map((rel) => (
                  <RelatedCICard key={rel.id} rel={rel} onSelect={setCenterId} />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
