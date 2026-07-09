'use client';

/**
 * app/[tenantSlug]/(app)/service-catalog/page.tsx — 서비스 카탈로그 관리자 UI (RX-3b)
 *
 * 백엔드 계약: backend/app/routers/service_catalog.py
 *   GET    /{tenant_slug}/service-catalog/offerings                    L335-361 (category_id, is_active 필터)
 *   PATCH  /{tenant_slug}/service-catalog/offerings/{off_id}/toggle-active  L526-542
 *
 * 권한: admin — 백엔드 require_roles(admin)와 동일 기준 (2026-07-07 admin 전용화, 구 admin+team_lead)
 *   (list_offerings/list_categories 자체는 get_current_user만 요구=요청자 브라우즈 유지,
 *    이 화면은 관리자 CUD 콘솔이므로 진입 자체를 admin으로 제한)
 *
 * approval_policy 다단/조건부 결재선 구조: backend/app/services/catalog_approval.py L1-44
 * 네비게이션: /settings '셋업' 그룹(admin 전용) 진입 — 2026-07-07 사이드바 serviceMgmt에서 축출
 */

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Pencil,
  Power,
  ShieldOff,
  PackageSearch,
  AlertCircle,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { isAdminRole } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CategoryPanel } from '@/components/catalog/CategoryPanel';
import { OfferingFormDialog } from '@/components/catalog/OfferingFormDialog';
import {
  PRIORITY_OPTIONS,
  type ServiceCategory,
  type ServiceOffering,
} from '@/components/catalog/catalogTypes';

type ActiveFilter = 'all' | 'active' | 'inactive';

// -----------------------------------------------------------------------
// 결재선 뱃지
// -----------------------------------------------------------------------
function ApprovalBadge({ offering }: { offering: ServiceOffering }) {
  const policy = offering.approval_policy;
  if (!policy?.required) {
    return <Badge variant="default">결재 없음</Badge>;
  }
  const steps = policy.steps ?? [];
  if (steps.length === 0) {
    return <Badge variant="warning">단일 승인</Badge>;
  }
  return <Badge variant="info">다단 결재 ({steps.length}단계)</Badge>;
}

function priorityLabel(p: string): string {
  return PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? p;
}

// -----------------------------------------------------------------------
// 메인 페이지
// -----------------------------------------------------------------------
export default function ServiceCatalogPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOffering, setEditingOffering] = useState<ServiceOffering | null>(null);

  const { data: categories = [] } = useQuery<ServiceCategory[]>({
    queryKey: ['catalog-categories', tenantSlug, false],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/service-catalog/categories`, { params: { include_inactive: false } })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const {
    data: offerings = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<ServiceOffering[]>({
    queryKey: ['catalog-offerings', tenantSlug, selectedCategoryId, activeFilter],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/service-catalog/offerings`, {
          params: {
            category_id: selectedCategoryId ?? undefined,
            is_active: activeFilter === 'all' ? undefined : activeFilter === 'active',
          },
        })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (offId: string) =>
      api
        .patch(`/${tenantSlug}/service-catalog/offerings/${offId}/toggle-active`)
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('활성 상태가 변경되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['catalog-offerings', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canManage = isAdminRole(user?.role);

  function openCreate() {
    setEditingOffering(null);
    setDialogOpen(true);
  }

  function openEdit(offering: ServiceOffering) {
    setEditingOffering(offering);
    setDialogOpen(true);
  }

  // 권한 없음 — hooks는 모두 위에서 선언 완료, 조건부 return은 여기서만
  if (!canManage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(18, 155, 142, 0.12)' }}
        >
          <ShieldOff size={24} strokeWidth={1.5} style={{ color: '#129B8E' }} />
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary">접근 권한 없음</p>
          <p className="text-xs text-text-secondary mt-1">
            서비스 카탈로그 관리는 관리자만 접근할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div>
          <h1 className="v2-page-title text-text-primary">서비스 카탈로그 관리</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            오퍼링별 신청 폼과 다단/조건부 결재선을 구성합니다.
          </p>
        </div>
        <Button leftIcon={<Plus size={14} />} onClick={openCreate}>
          새 오퍼링
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        <CategoryPanel
          tenantSlug={tenantSlug}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
        />

        <div className="flex flex-1 flex-col min-h-0">
          {/* 필터 바 */}
          <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle shrink-0">
            <span className="text-xs text-text-secondary">상태</span>
            <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as ActiveFilter)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="active">활성</SelectItem>
                <SelectItem value="inactive">비활성</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-text-disabled ml-auto">{offerings.length}개</span>
          </div>

          {/* 오퍼링 테이블 — ALVEO-V2 Track 4: 카드 래핑 (외곽 rounded+border는 overflow-hidden, 스크롤/sticky는 내부 div가 담당) */}
          <div className="mx-6 mb-4 mt-4 flex-1 min-h-0 flex flex-col rounded-[14px] border border-border-default bg-surface shadow-[var(--shadow-card)] overflow-hidden">
          <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                    이름 / code
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                    요청 유형
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                    기본 우선순위
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                    신청 폼
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                    결재선
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                    상태
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary">
                    액션
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border-subtle">
                      <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-5 w-24 rounded-full" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-7 w-20 rounded-md ml-auto" /></td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center">
                      <AlertCircle size={32} className="mx-auto mb-3 text-error" />
                      <p className="text-sm text-text-secondary mb-3">
                        데이터를 불러오지 못했습니다.
                      </p>
                      <button
                        onClick={() => refetch()}
                        className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
                      >
                        <RefreshCw size={12} />
                        다시 시도
                      </button>
                    </td>
                  </tr>
                ) : offerings.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded-2xl"
                          style={{ background: 'var(--color-info-bg)' }}
                        >
                          <PackageSearch size={24} strokeWidth={1.5} style={{ color: 'var(--color-info)' }} />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-text-primary">오퍼링이 없습니다</p>
                          <p className="text-xs text-text-secondary mt-0.5">
                            새 오퍼링을 추가해 신청 폼과 결재선을 구성하세요.
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  offerings.map((offering) => (
                    <tr
                      key={offering.id}
                      className={cn(
                        'border-b border-border-subtle hover:bg-surface-hover transition-colors',
                        !offering.is_active && 'opacity-50',
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-text-primary">{offering.name}</span>
                          {offering.is_system && (
                            <span title="시스템 오퍼링">
                              <Lock size={11} className="text-text-disabled" />
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-text-disabled">{offering.code}</span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {offering.request_type}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {priorityLabel(offering.default_priority)}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {(offering.form_schema?.fields ?? []).length}개 필드
                      </td>
                      <td className="px-4 py-3">
                        <ApprovalBadge offering={offering} />
                      </td>
                      <td className="px-4 py-3">
                        {offering.is_active ? (
                          <Badge variant="success">활성</Badge>
                        ) : (
                          <Badge variant="default">비활성</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Pencil size={12} />}
                            onClick={() => openEdit(offering)}
                          >
                            수정
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Power size={12} />}
                            isLoading={
                              toggleActiveMutation.isPending &&
                              toggleActiveMutation.variables === offering.id
                            }
                            disabled={toggleActiveMutation.isPending}
                            onClick={() => toggleActiveMutation.mutate(offering.id)}
                          >
                            {offering.is_active ? '비활성화' : '활성화'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      </div>

      <OfferingFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        tenantSlug={tenantSlug}
        categories={categories}
        editing={editingOffering}
      />
    </div>
  );
}
