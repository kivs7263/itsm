'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, GitMerge, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  ChangeRequest,
  ChangeRequestsResponse,
  CRStatus,
  CRChangeType,
  CRRiskLevel,
  CRPriority,
} from '@/lib/types';
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
import { CreateCRModal } from '@/components/change-requests/CreateCRModal';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove } from '@/lib/auth';

// -----------------------------------------------------------------------
// 상수 매핑
// -----------------------------------------------------------------------
const CR_STATUS_STYLES: Record<CRStatus, string> = {
  draft:              'bg-neutral-100 text-neutral-500',
  pending_review:     'bg-info-bg text-info-text',
  pending_approval:   'bg-warning-bg text-warning-text',
  approved:           'bg-success-bg text-success-text',
  scheduled:          'bg-info-bg text-info-text',
  in_progress:        'bg-blue-50 text-blue-600',
  completed:          'bg-success-bg text-success-text',
  rejected:           'bg-error-bg text-error-text',
  cancelled:          'bg-neutral-100 text-neutral-500',
};

const CR_STATUS_LABELS: Record<CRStatus, string> = {
  draft:              '초안',
  pending_review:     '검토대기',
  pending_approval:   '결재대기',
  approved:           '승인됨',
  scheduled:          '일정확정',
  in_progress:        '진행중',
  completed:          '완료',
  rejected:           '반려',
  cancelled:          '취소',
};

const CR_CHANGE_TYPE_LABELS: Record<CRChangeType, string> = {
  normal:    '일반',
  emergency: '긴급',
  standard:  '표준',
};

const CR_RISK_STYLES: Record<CRRiskLevel, string> = {
  critical: 'bg-error-bg text-error-text',
  high:     'bg-warning-bg text-warning-text',
  medium:   'bg-info-bg text-info-text',
  low:      'bg-neutral-100 text-neutral-500',
};

const CR_RISK_LABELS: Record<CRRiskLevel, string> = {
  critical: '긴급',
  high:     '높음',
  medium:   '보통',
  low:      '낮음',
};

const CR_PRIORITY_LABELS: Record<CRPriority, string> = {
  critical: '긴급',
  high:     '높음',
  medium:   '보통',
  low:      '낮음',
};

// -----------------------------------------------------------------------
// 배지 컴포넌트
// -----------------------------------------------------------------------
function CRStatusBadge({ status }: { status: CRStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', CR_STATUS_STYLES[status])}>
      {CR_STATUS_LABELS[status]}
    </span>
  );
}

function CRRiskBadge({ riskLevel }: { riskLevel: CRRiskLevel }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', CR_RISK_STYLES[riskLevel])}>
      {CR_RISK_LABELS[riskLevel]}
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
          <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 빈 상태
// -----------------------------------------------------------------------
function EmptyState({ onNew, canCreate }: { onNew: () => void; canCreate: boolean }) {
  return (
    <tr>
      <td colSpan={8}>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <GitMerge size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">변경 요청 없음</p>
            <p className="mt-1 text-sm text-text-secondary">
              등록된 변경 요청이 없습니다.
            </p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={onNew} leftIcon={<Plus size={14} />}>
              새 변경 요청
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 필터 상태
// -----------------------------------------------------------------------
interface Filters {
  status: string;
  change_type: string;
  risk_level: string;
  search: string;
}

// -----------------------------------------------------------------------
// 페이지네이션
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
// 변경 관리 목록 페이지
// -----------------------------------------------------------------------
export default function ChangeRequestsPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const router = useRouter();
  const { user } = useAuth();

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    status:      '',
    change_type: '',
    risk_level:  '',
    search:      '',
  });
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = isTeamLeadOrAbove(user?.role);

  const { data, isLoading, isError, refetch } = useQuery<ChangeRequestsResponse>({
    queryKey: ['change-requests', tenantSlug, filters, page],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/change-requests`, {
          params: {
            ...(filters.status      ? { status:      filters.status }      : {}),
            ...(filters.change_type ? { change_type: filters.change_type } : {}),
            ...(filters.risk_level  ? { risk_level:  filters.risk_level }  : {}),
            ...(filters.search      ? { search:      filters.search }      : {}),
            page,
            page_size: PAGE_SIZE,
          },
        })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const items: ChangeRequest[] = data?.items ?? [];
  const total = data?.total ?? 0;

  function handleFilterChange(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value === 'all' ? '' : value }));
    setPage(1);
  }

  function handleRowClick(cr: ChangeRequest) {
    router.push(`/${tenantSlug}/change-requests/${cr.id}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="v2-page-title text-text-primary">변경 관리</h1>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)} leftIcon={<Plus size={14} />}>
            새 변경 요청
          </Button>
        )}
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface shrink-0 flex-wrap">
        {/* 검색 */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            placeholder="변경 요청 검색..."
            className="h-8 pl-8 pr-3 w-52 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>

        {/* 상태 */}
        <div className="w-36">
          <Select value={filters.status || 'all'} onValueChange={(v) => handleFilterChange('status', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="상태 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">상태 전체</SelectItem>
              <SelectItem value="draft">초안</SelectItem>
              <SelectItem value="pending_review">검토대기</SelectItem>
              <SelectItem value="pending_approval">결재대기</SelectItem>
              <SelectItem value="approved">승인됨</SelectItem>
              <SelectItem value="scheduled">일정확정</SelectItem>
              <SelectItem value="in_progress">진행중</SelectItem>
              <SelectItem value="completed">완료</SelectItem>
              <SelectItem value="rejected">반려</SelectItem>
              <SelectItem value="cancelled">취소</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 유형 */}
        <div className="w-28">
          <Select value={filters.change_type || 'all'} onValueChange={(v) => handleFilterChange('change_type', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="유형 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">유형 전체</SelectItem>
              <SelectItem value="normal">일반</SelectItem>
              <SelectItem value="emergency">긴급</SelectItem>
              <SelectItem value="standard">표준</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 위험도 */}
        <div className="w-32">
          <Select value={filters.risk_level || 'all'} onValueChange={(v) => handleFilterChange('risk_level', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="위험도 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">위험도 전체</SelectItem>
              <SelectItem value="critical">긴급</SelectItem>
              <SelectItem value="high">높음</SelectItem>
              <SelectItem value="medium">보통</SelectItem>
              <SelectItem value="low">낮음</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 테이블 — ALVEO-V2 Track 4: 카드 래핑 (외곽 rounded+border는 overflow-hidden, 스크롤/sticky는 내부 div가 담당) */}
      <div className="mx-6 mb-4 mt-4 flex-1 min-h-0 flex flex-col rounded-[14px] border border-border-default bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">제목</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">유형</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">위험도</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">우선순위</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">신청자</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">계획 시작일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">수정일</th>
            </tr>
          </thead>
          <tbody>
            {isError ? (
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
            ) : isLoading ? (
              <SkeletonRows />
            ) : items.length === 0 ? (
              <EmptyState onNew={() => setCreateOpen(true)} canCreate={canCreate} />
            ) : (
              items.map((cr) => (
                <tr
                  key={cr.id}
                  onClick={() => handleRowClick(cr)}
                  className={cn(
                    'border-b border-border-subtle cursor-pointer',
                    'hover:bg-surface-hover transition-colors duration-micro',
                  )}
                >
                  <td className="px-4 py-3 font-medium text-text-primary max-w-[240px] truncate">
                    {typeof cr.title === 'string' ? cr.title : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {CR_CHANGE_TYPE_LABELS[cr.change_type] ?? cr.change_type}
                  </td>
                  <td className="px-4 py-3">
                    <CRStatusBadge status={cr.status} />
                  </td>
                  <td className="px-4 py-3">
                    <CRRiskBadge riskLevel={cr.risk_level} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {CR_PRIORITY_LABELS[cr.priority] ?? cr.priority}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {typeof cr.requestor_name === 'string' ? cr.requestor_name : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {typeof cr.planned_start === 'string'
                      ? cr.planned_start.slice(0, 10)
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {formatRelativeTime(cr.updated_at)}
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
      <CreateCRModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
