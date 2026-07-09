'use client';

// -----------------------------------------------------------------------
// CIListView — RX-1c: /cmdb 페이지 본문을 인프라 탭 콘텐츠로 이전
// (원본: app/[tenantSlug]/(app)/cmdb/page.tsx)
// 기능은 전부 보존, 상단 "CMDB" 타이틀 h1만 제거(탭 라벨과 중복이므로).
// -----------------------------------------------------------------------

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Server, Upload, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { CI, CIType, CIStatus, CIEnvironment, CICriticality, CIsResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CreateCIModal } from '@/components/cmdb/CreateCIModal';
import { CMDBImportModal } from '@/components/cmdb/CMDBImportModal';

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
  test:        '테스트',
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
// 스켈레톤 행
// -----------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 빈 상태
// -----------------------------------------------------------------------
function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <tr>
      <td colSpan={8}>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <Server size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">CI 없음</p>
            <p className="mt-1 text-sm text-text-secondary">
              등록된 구성 항목(CI)이 없습니다. 새 CI를 추가해보세요.
            </p>
          </div>
          <Button size="sm" onClick={onNew} leftIcon={<Plus size={14} />}>
            새 CI
          </Button>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 필터 상태
// -----------------------------------------------------------------------
interface Filters {
  ci_type: string;
  status: string;
  environment: string;
  criticality: string;
  search: string;
}

// -----------------------------------------------------------------------
// 페이지네이션 버튼
// -----------------------------------------------------------------------
function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border-subtle">
      <Button
        size="sm"
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        이전
      </Button>
      <span className="text-xs text-text-secondary">
        {page} / {totalPages}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        다음
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------
// CMDB CI 목록 뷰 (인프라 탭 콘텐츠)
// -----------------------------------------------------------------------
export function CIListView() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const router = useRouter();

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    ci_type: '',
    status: '',
    environment: '',
    criticality: '',
    search: '',
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<CIsResponse>({
    queryKey: ['cmdb-cis', tenantSlug, filters, page],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/cmdb/cis`, {
          params: {
            ...(filters.ci_type     ? { ci_type:     filters.ci_type }     : {}),
            ...(filters.status      ? { status:      filters.status }      : {}),
            ...(filters.environment ? { environment: filters.environment } : {}),
            ...(filters.criticality ? { criticality: filters.criticality } : {}),
            ...(filters.search      ? { search:      filters.search }      : {}),
            page,
            page_size: PAGE_SIZE,
          },
        })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const cis: CI[] = data?.items ?? [];
  const total = data?.total ?? 0;

  function handleFilterChange(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value === 'all' ? '' : value }));
    setPage(1);
  }

  function handleRowClick(ci: CI) {
    router.push(`/${tenantSlug}/cmdb/${ci.id}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 필터 바 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface shrink-0 flex-wrap">
        {/* 검색 */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            placeholder="CI 검색..."
            className="h-8 pl-8 pr-3 w-48 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>

        {/* CI 유형 */}
        <div className="w-36">
          <Select value={filters.ci_type || 'all'} onValueChange={(v) => handleFilterChange('ci_type', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="유형 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">유형 전체</SelectItem>
              {(Object.entries(CI_TYPE_LABELS) as [CIType, string][]).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 상태 */}
        <div className="w-32">
          <Select value={filters.status || 'all'} onValueChange={(v) => handleFilterChange('status', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="상태 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">상태 전체</SelectItem>
              <SelectItem value="active">운영중</SelectItem>
              <SelectItem value="inactive">비활성</SelectItem>
              <SelectItem value="maintenance">유지보수</SelectItem>
              <SelectItem value="decommissioned">폐기</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 환경 */}
        <div className="w-32">
          <Select value={filters.environment || 'all'} onValueChange={(v) => handleFilterChange('environment', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="환경 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">환경 전체</SelectItem>
              <SelectItem value="production">운영</SelectItem>
              <SelectItem value="staging">스테이징</SelectItem>
              <SelectItem value="development">개발</SelectItem>
              <SelectItem value="test">테스트</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 중요도 */}
        <div className="w-32">
          <Select value={filters.criticality || 'all'} onValueChange={(v) => handleFilterChange('criticality', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="중요도 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">중요도 전체</SelectItem>
              <SelectItem value="critical">긴급</SelectItem>
              <SelectItem value="high">높음</SelectItem>
              <SelectItem value="medium">보통</SelectItem>
              <SelectItem value="low">낮음</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 우측 액션 */}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)} leftIcon={<Upload size={14} />}>
            가져오기
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} leftIcon={<Plus size={14} />}>
            새 CI
          </Button>
        </div>
      </div>

      {/* 테이블 — ALVEO-V2 Track 4: 카드 래핑 (외곽 rounded+border는 overflow-hidden, 스크롤/sticky는 내부 div가 담당) */}
      <div className="mx-6 mb-4 mt-4 flex-1 min-h-0 flex flex-col rounded-[14px] border border-border-default bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이름</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">CI 유형</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">환경</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">중요도</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">고객</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">IP</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">수정일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : isError ? ( /* AS-W1 */
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <AlertCircle size={32} className="mx-auto mb-3 text-error" />
                  <p className="text-sm text-text-secondary mb-3">데이터를 불러오지 못했습니다.</p>
                  <button
                    onClick={() => refetch()}
                    className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
                  >
                    <RefreshCw size={12} />
                    다시 시도
                  </button>
                </td>
              </tr>
            ) : cis.length === 0 ? (
              <EmptyState onNew={() => setCreateOpen(true)} />
            ) : (
              cis.map((ci) => (
                <tr
                  key={ci.id}
                  onClick={() => handleRowClick(ci)}
                  className={cn(
                    'border-b border-border-subtle cursor-pointer',
                    'hover:bg-surface-hover transition-colors duration-micro',
                  )}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    {typeof ci.name === 'string' ? ci.name : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {CI_TYPE_LABELS[ci.ci_type] ?? ci.ci_type}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {CI_ENV_LABELS[ci.environment] ?? ci.environment}
                  </td>
                  <td className="px-4 py-3">
                    <CIStatusBadge status={ci.status} />
                  </td>
                  <td className="px-4 py-3">
                    <CICriticalityBadge criticality={ci.criticality} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {typeof ci.customer_name === 'string' ? ci.customer_name : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs font-mono">
                    {typeof ci.ip_address === 'string' ? ci.ip_address : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {formatRelativeTime(ci.updated_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      {/* 페이지네이션 */}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />

      {/* 생성 모달 */}
      <CreateCIModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />

      {/* Import 모달 */}
      <CMDBImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
