'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { ArrowLeft, Plus, Server } from 'lucide-react';
import { api } from '@/lib/api';
import type { CI, CIDetailResponse, CIRelationship, CIHistory, CIStatus, CICriticality, CIType, RelType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AddRelationshipModal } from '@/components/cmdb/AddRelationshipModal';

// -----------------------------------------------------------------------
// 상수 매핑
// -----------------------------------------------------------------------
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

const CI_CRITICALITY_STYLES: Record<CICriticality, string> = {
  critical: 'bg-error-bg text-error-text',
  high:     'bg-warning-bg text-warning-text',
  medium:   'bg-info-bg text-info-text',
  low:      'bg-neutral-100 text-neutral-500',
};

const CI_CRITICALITY_LABELS: Record<CICriticality, string> = {
  critical: '긴급',
  high:     '높음',
  medium:   '보통',
  low:      '낮음',
};

const CI_ENV_LABELS: Record<string, string> = {
  production:  '운영',
  staging:     '스테이징',
  development: '개발',
  testing:     '테스트',
  dr:          'DR',
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

// -----------------------------------------------------------------------
// 배지 컴포넌트
// -----------------------------------------------------------------------
function CIStatusBadge({ status }: { status: CIStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', CI_STATUS_STYLES[status])}>
      {CI_STATUS_LABELS[status]}
    </span>
  );
}

function CICriticalityBadge({ criticality }: { criticality: CICriticality }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', CI_CRITICALITY_STYLES[criticality])}>
      {CI_CRITICALITY_LABELS[criticality]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 정보 행 컴포넌트
// -----------------------------------------------------------------------
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border-subtle last:border-0">
      <span className="text-xs text-text-disabled w-24 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-text-primary flex-1">{children}</span>
    </div>
  );
}

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border-default bg-surface">
        <Skeleton className="h-6 w-48" />
      </div>
      <div className="flex-1 p-6 grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        <div className="col-span-2 space-y-3">
          <Skeleton className="h-8 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 관계 목록 탭
// -----------------------------------------------------------------------
function RelationshipsTab({
  relationships,
  onAdd,
}: {
  relationships: CIRelationship[];
  onAdd: () => void;
}) {
  if (relationships.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-text-secondary">등록된 관계가 없습니다.</p>
        <Button size="sm" variant="outline" onClick={onAdd} leftIcon={<Plus size={14} />}>
          관계 추가
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onAdd} leftIcon={<Plus size={14} />}>
          관계 추가
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default">
            <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3">방향</th>
            <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3">대상 CI</th>
            <th className="text-left text-xs font-medium text-text-secondary py-2">관계 유형</th>
          </tr>
        </thead>
        <tbody>
          {relationships.map((rel) => {
            const isOut = rel.direction === 'out';
            const relatedName = rel.related_ci?.name ?? rel.related_ci?.id ?? '-';
            return (
              <tr key={rel.id} className="border-b border-border-subtle">
                <td className="py-2 pr-3">
                  <span className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                    isOut
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-purple-50 text-purple-600',
                  )}>
                    {isOut ? '→ 대상' : '← 소스'}
                  </span>
                </td>
                <td className="py-2 pr-3 text-text-primary font-medium">
                  {typeof relatedName === 'string' ? relatedName : '-'}
                </td>
                <td className="py-2 text-text-secondary text-xs">
                  {REL_TYPE_LABELS[rel.rel_type] ?? rel.rel_type}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -----------------------------------------------------------------------
// 변경 이력 탭
// -----------------------------------------------------------------------
function HistoryTab({ history }: { history: CIHistory[] }) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-text-secondary">변경 이력이 없습니다.</p>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border-default">
          <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3">필드</th>
          <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3">이전 값</th>
          <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3">새 값</th>
          <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3">사유</th>
          <th className="text-left text-xs font-medium text-text-secondary py-2">일시</th>
        </tr>
      </thead>
      <tbody>
        {history.map((h) => (
          <tr key={h.id} className="border-b border-border-subtle">
            <td className="py-2 pr-3 text-text-primary font-medium font-mono text-xs">
              {typeof h.field_name === 'string' ? h.field_name : '-'}
            </td>
            <td className="py-2 pr-3 text-text-secondary text-xs max-w-[120px] truncate">
              {typeof h.old_value === 'string' ? h.old_value : '-'}
            </td>
            <td className="py-2 pr-3 text-text-primary text-xs max-w-[120px] truncate">
              {typeof h.new_value === 'string' ? h.new_value : '-'}
            </td>
            <td className="py-2 pr-3 text-text-secondary text-xs">
              {typeof h.change_reason === 'string' ? h.change_reason : '-'}
            </td>
            <td className="py-2 text-text-disabled text-xs whitespace-nowrap">
              {formatRelativeTime(h.created_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// -----------------------------------------------------------------------
// CI 상세 페이지
// -----------------------------------------------------------------------
type TabKey = 'relationships' | 'history';

export default function CIDetailPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const ciId = params?.ciId as string;
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabKey>('relationships');
  const [addRelOpen, setAddRelOpen] = useState(false);

  // CI 상세 조회 — 백엔드 응답: { ci: CIOut, relationships: [...] }
  const { data: detailResponse, isLoading, isError, error: queryError } = useQuery<CIDetailResponse>({
    queryKey: ['cmdb-ci-detail', tenantSlug, ciId],
    queryFn: () => api.get(`/${tenantSlug}/cmdb/cis/${ciId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!ciId,
  });

  // 변경 이력 조회
  const { data: historyData } = useQuery<CIHistory[]>({
    queryKey: ['cmdb-ci-history', tenantSlug, ciId],
    queryFn: () => api.get(`/${tenantSlug}/cmdb/cis/${ciId}/history`).then((r) => r.data),
    enabled: !!tenantSlug && !!ciId && activeTab === 'history',
  });

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-error-bg">
          <AlertTriangle size={22} className="text-error-text" />
        </div>
        <p className="text-sm text-text-secondary">CI 정보를 불러오지 못했습니다.</p>
        {queryError instanceof Error && (
          <p className="text-xs text-text-disabled max-w-xs text-center">{queryError.message}</p>
        )}
        <Button size="sm" variant="ghost" onClick={() => router.back()}>
          돌아가기
        </Button>
      </div>
    );
  }

  const ci = detailResponse?.ci ?? null;

  if (!ci) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-text-secondary">CI를 찾을 수 없습니다.</p>
        <Button size="sm" variant="ghost" onClick={() => router.back()}>
          돌아가기
        </Button>
      </div>
    );
  }

  // 관계 목록 — 백엔드: { direction: 'out'|'in', related_ci: {...} } 배열
  const relationships: CIRelationship[] = Array.isArray(detailResponse?.relationships)
    ? detailResponse.relationships
    : [];

  const history: CIHistory[] = Array.isArray(historyData) ? historyData : [];

  const descriptionAttr = ci.attributes?.description;
  const descriptionText = typeof descriptionAttr === 'string' ? descriptionAttr : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/cmdb`)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span>CMDB</span>
        </button>
        <span className="text-text-disabled">/</span>
        <h1 className="text-xl font-semibold text-text-primary truncate">
          {typeof ci.name === 'string' ? ci.name : ciId}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <CIStatusBadge status={ci.status} />
          <CICriticalityBadge criticality={ci.criticality} />
        </div>
      </div>

      {/* 본문 — 2컬럼 */}
      <div className="flex-1 overflow-auto min-h-0 p-6">
        <div className="grid grid-cols-3 gap-6 h-full">
          {/* 좌측: 기본 정보 카드 */}
          <div className="col-span-1">
            <div className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(18, 155, 142, 0.12)' }}
                >
                  <Server size={16} style={{ color: '#129B8E' }} />
                </div>
                <span className="text-sm font-semibold text-text-primary">기본 정보</span>
              </div>

              <div className="divide-y divide-border-subtle">
                <InfoRow label="이름">
                  {typeof ci.name === 'string' ? ci.name : '-'}
                </InfoRow>
                <InfoRow label="CI 유형">
                  {CI_TYPE_LABELS[ci.ci_type] ?? ci.ci_type}
                </InfoRow>
                <InfoRow label="환경">
                  {CI_ENV_LABELS[ci.environment] ?? ci.environment}
                </InfoRow>
                <InfoRow label="상태">
                  <CIStatusBadge status={ci.status} />
                </InfoRow>
                <InfoRow label="중요도">
                  <CICriticalityBadge criticality={ci.criticality} />
                </InfoRow>
                <InfoRow label="IP 주소">
                  <span className="font-mono text-xs">
                    {typeof ci.ip_address === 'string' ? ci.ip_address : '-'}
                  </span>
                </InfoRow>
                <InfoRow label="호스트명">
                  <span className="font-mono text-xs">
                    {typeof ci.hostname === 'string' ? ci.hostname : '-'}
                  </span>
                </InfoRow>
                <InfoRow label="OS">
                  {[ci.os_type, ci.os_version].filter(Boolean).join(' ') || '-'}
                </InfoRow>
                <InfoRow label="고객">
                  {typeof ci.customer_name === 'string' ? ci.customer_name : '-'}
                </InfoRow>
                {descriptionText && (
                  <InfoRow label="설명">
                    <span className="text-xs text-text-secondary">{descriptionText}</span>
                  </InfoRow>
                )}
                <InfoRow label="수정일">
                  <span className="text-xs">{formatRelativeTime(ci.updated_at)}</span>
                </InfoRow>
              </div>
            </div>
          </div>

          {/* 우측: 탭 */}
          <div className="col-span-2">
            <div className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 h-full flex flex-col">
              {/* 탭 헤더 */}
              <div className="flex border-b border-border-subtle mb-4">
                {([
                  { key: 'relationships' as TabKey, label: `관계 (${relationships.length})` },
                  { key: 'history' as TabKey,       label: '변경 이력' },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={cn(
                      'px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
                      activeTab === key
                        ? 'border-brand text-text-primary'
                        : 'border-transparent text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* 탭 본문 */}
              <div className="flex-1 overflow-auto">
                {activeTab === 'relationships' && (
                  <RelationshipsTab
                    relationships={relationships}
                    onAdd={() => setAddRelOpen(true)}
                  />
                )}
                {activeTab === 'history' && (
                  <HistoryTab history={history} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 관계 추가 모달 */}
      <AddRelationshipModal
        open={addRelOpen}
        onClose={() => setAddRelOpen(false)}
        tenantSlug={tenantSlug}
        ciId={ciId}
      />
    </div>
  );
}
