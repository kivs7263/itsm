'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ArrowLeft, GitMerge, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { ChangeRequest, CRStatus, CRRiskLevel, CRPriority } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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

const GW_STATUS_LABELS: Record<string, string> = {
  not_submitted:      '미제출',
  pending:            '결재중',
  approved:           '결재승인',
  rejected:           '결재반려',
  gw_not_configured:  'GW 미설정',
};

const GW_STATUS_STYLES: Record<string, string> = {
  not_submitted:     'bg-neutral-100 text-neutral-500',
  pending:           'bg-warning-bg text-warning-text',
  approved:          'bg-success-bg text-success-text',
  rejected:          'bg-error-bg text-error-text',
  gw_not_configured: 'bg-neutral-100 text-neutral-400',
};

// -----------------------------------------------------------------------
// 서브 컴포넌트
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

function GWStatusBadge({ gwStatus }: { gwStatus: string }) {
  const style = GW_STATUS_STYLES[gwStatus] ?? 'bg-neutral-100 text-neutral-500';
  const label = GW_STATUS_LABELS[gwStatus] ?? gwStatus;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', style)}>
      {label}
    </span>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border-subtle last:border-0">
      <span className="text-xs text-text-disabled w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-text-primary flex-1">{children}</span>
    </div>
  );
}

function PlanTextBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <div className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 min-h-[80px]">
        <p className="text-sm text-text-primary whitespace-pre-wrap">
          {typeof value === 'string' && value ? value : <span className="text-text-disabled">-</span>}
        </p>
      </div>
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
        <Skeleton className="h-6 w-64" />
      </div>
      <div className="flex-1 p-6 grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        <div className="col-span-2 space-y-3">
          <Skeleton className="h-8 w-48" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 타입
// -----------------------------------------------------------------------
type TabKey = 'info' | 'plan' | 'linked_cis';

// -----------------------------------------------------------------------
// 상세 페이지
// -----------------------------------------------------------------------
export default function CRDetailPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const crId = params?.crId as string;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('info');
  const [actionLoading, setActionLoading] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');

  const isPrivileged = isTeamLeadOrAbove(user?.role);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/${tenantSlug}/change-requests/${crId}`),
    onSuccess: () => {
      toast.success('변경 요청이 삭제되었습니다.');
      router.push(`/${tenantSlug}/change-requests`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const removeCiLinkMutation = useMutation({
    mutationFn: (ciId: string) =>
      api.delete(`/${tenantSlug}/change-requests/${crId}/ci-links/${ciId}`),
    onSuccess: () => {
      toast.success('CI 연결이 해제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['change-request', tenantSlug, crId] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const { data: cr, isLoading } = useQuery<ChangeRequest>({
    queryKey: ['change-request', tenantSlug, crId],
    queryFn: () => api.get(`/${tenantSlug}/change-requests/${crId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!crId,
  });

  // 상태 전이 액션 핸들러
  async function handleAction(
    endpoint: string,
    body?: Record<string, string>,
    successMsg = '처리되었습니다.',
  ) {
    setActionLoading(true);
    try {
      await api.post(`/${tenantSlug}/change-requests/${crId}/${endpoint}`, body ?? {});
      toast.success(successMsg);
      await queryClient.invalidateQueries({ queryKey: ['change-request', tenantSlug, crId] });
      await queryClient.invalidateQueries({ queryKey: ['change-requests', tenantSlug] });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  if (isLoading) return <PageSkeleton />;
  if (!cr) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-text-secondary">변경 요청을 찾을 수 없습니다.</p>
        <Button size="sm" variant="ghost" onClick={() => router.back()}>
          돌아가기
        </Button>
      </div>
    );
  }

  // 상태별 액션 버튼 목록
  const actionButtons: React.ReactNode[] = [];

  if (cr.status === 'draft') {
    actionButtons.push(
      <Button
        key="submit"
        size="sm"
        isLoading={actionLoading}
        onClick={() => handleAction('submit', undefined, '검토 제출이 완료되었습니다.')}
      >
        검토 제출
      </Button>,
    );
  }

  if (cr.status === 'pending_review' && isPrivileged) {
    actionButtons.push(
      <Button
        key="submit-gw"
        size="sm"
        isLoading={actionLoading}
        onClick={() => handleAction('submit-gw', undefined, 'GW 결재가 제출되었습니다.')}
      >
        GW 결재 제출
      </Button>,
    );
  }

  if (cr.status === 'pending_approval' && isPrivileged) {
    actionButtons.push(
      <Button
        key="approve"
        size="sm"
        isLoading={actionLoading}
        onClick={() => handleAction('approve', undefined, '승인되었습니다.')}
      >
        승인
      </Button>,
      <Button
        key="reject"
        size="sm"
        variant="outline"
        isLoading={actionLoading}
        onClick={() => handleAction('reject', undefined, '반려되었습니다.')}
      >
        반려
      </Button>,
    );
  }

  if (cr.status === 'approved' && isPrivileged) {
    actionButtons.push(
      <Button
        key="schedule"
        size="sm"
        isLoading={actionLoading}
        onClick={() => {
          setScheduledStart('');
          setScheduledEnd('');
          setScheduleDialogOpen(true);
        }}
      >
        일정 확정
      </Button>,
    );
  }

  if (cr.status === 'scheduled' && isPrivileged) {
    actionButtons.push(
      <Button
        key="start"
        size="sm"
        isLoading={actionLoading}
        onClick={() => handleAction('start', undefined, '진행이 시작되었습니다.')}
      >
        시작
      </Button>,
    );
  }

  if (cr.status === 'in_progress' && isPrivileged) {
    actionButtons.push(
      <Button
        key="complete"
        size="sm"
        isLoading={actionLoading}
        onClick={() => handleAction('complete', undefined, '완료 처리되었습니다.')}
      >
        완료
      </Button>,
    );
  }

  if (cr.gw_approval_doc_id) {
    actionButtons.push(
      <Button
        key="sync-gw"
        size="sm"
        variant="outline"
        isLoading={actionLoading}
        leftIcon={<RefreshCw size={14} />}
        onClick={() => handleAction('sync-gw', undefined, 'GW 상태가 동기화되었습니다.')}
      >
        GW 상태 동기화
      </Button>,
    );
  }

  return (
    <>
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <button
          type="button"
          onClick={() => router.push(`/${tenantSlug}/change-requests`)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span>변경 관리</span>
        </button>
        <span className="text-text-disabled">/</span>
        <h1 className="text-xl font-semibold text-text-primary truncate flex-1">
          {typeof cr.title === 'string' ? cr.title : crId}
        </h1>
        <div className="flex items-center gap-2">
          <CRStatusBadge status={cr.status} />
          <CRRiskBadge riskLevel={cr.risk_level} />
        </div>
        {actionButtons.length > 0 && (
          <div className="flex items-center gap-2 ml-2">
            {actionButtons}
          </div>
        )}
        {cr.status === 'draft' && isPrivileged && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Trash2 size={13} />}
            onClick={() => setDeleteDialogOpen(true)}
            className="text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            삭제
          </Button>
        )}
      </div>

      {/* 본문 — 2컬럼 */}
      <div className="flex-1 overflow-auto min-h-0 p-6">
        <div className="grid grid-cols-3 gap-6 h-full">
          {/* 좌측: 기본 요약 카드 */}
          <div className="col-span-1">
            <div className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: 'rgba(18, 155, 142, 0.12)' }}
                >
                  <GitMerge size={16} style={{ color: '#129B8E' }} />
                </div>
                <span className="text-sm font-semibold text-text-primary">변경 요약</span>
              </div>

              <div className="divide-y divide-border-subtle">
                <InfoRow label="유형">
                  {cr.change_type === 'normal' ? '일반' : cr.change_type === 'emergency' ? '긴급' : '표준'}
                </InfoRow>
                <InfoRow label="상태">
                  <CRStatusBadge status={cr.status} />
                </InfoRow>
                <InfoRow label="위험도">
                  <CRRiskBadge riskLevel={cr.risk_level} />
                </InfoRow>
                <InfoRow label="우선순위">
                  {CR_PRIORITY_LABELS[cr.priority] ?? cr.priority}
                </InfoRow>
                <InfoRow label="신청자">
                  {typeof cr.requestor_name === 'string' ? cr.requestor_name : '-'}
                </InfoRow>
                <InfoRow label="담당자">
                  {typeof cr.implementor_name === 'string' ? cr.implementor_name : '-'}
                </InfoRow>
                <InfoRow label="검토자">
                  {typeof cr.reviewer_name === 'string' ? cr.reviewer_name : '-'}
                </InfoRow>
                <InfoRow label="수정일">
                  <span className="text-xs">{formatRelativeTime(cr.updated_at)}</span>
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
                  { key: 'info' as TabKey,       label: '기본 정보' },
                  { key: 'plan' as TabKey,       label: '계획' },
                  { key: 'linked_cis' as TabKey, label: `연관 CI (${cr.linked_cis?.length ?? 0})` },
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
                {/* 기본 정보 탭 */}
                {activeTab === 'info' && (
                  <div className="flex flex-col gap-4">
                    <div className="divide-y divide-border-subtle">
                      <InfoRow label="제목">
                        <span className="font-medium">
                          {typeof cr.title === 'string' ? cr.title : '-'}
                        </span>
                      </InfoRow>
                      <InfoRow label="설명">
                        <span className="text-sm text-text-secondary whitespace-pre-wrap">
                          {typeof cr.description === 'string' && cr.description
                            ? cr.description
                            : <span className="text-text-disabled">-</span>}
                        </span>
                      </InfoRow>
                      <InfoRow label="GW 결재 상태">
                        <GWStatusBadge gwStatus={cr.gw_approval_status} />
                      </InfoRow>
                    </div>
                  </div>
                )}

                {/* 계획 탭 */}
                {activeTab === 'plan' && (
                  <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-text-secondary">계획 시작일</span>
                        <p className="text-sm text-text-primary">
                          {typeof cr.planned_start === 'string' ? cr.planned_start.slice(0, 16).replace('T', ' ') : '-'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-text-secondary">계획 종료일</span>
                        <p className="text-sm text-text-primary">
                          {typeof cr.planned_end === 'string' ? cr.planned_end.slice(0, 16).replace('T', ' ') : '-'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-text-secondary">실제 시작일</span>
                        <p className="text-sm text-text-primary">
                          {typeof cr.actual_start === 'string' ? cr.actual_start.slice(0, 16).replace('T', ' ') : '-'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-text-secondary">실제 종료일</span>
                        <p className="text-sm text-text-primary">
                          {typeof cr.actual_end === 'string' ? cr.actual_end.slice(0, 16).replace('T', ' ') : '-'}
                        </p>
                      </div>
                    </div>
                    <PlanTextBlock label="구현 계획" value={cr.implementation_plan} />
                    <PlanTextBlock label="롤백 계획" value={cr.rollback_plan} />
                    <PlanTextBlock label="테스트 계획" value={cr.test_plan} />
                  </div>
                )}

                {/* 연관 CI 탭 */}
                {activeTab === 'linked_cis' && (
                  <div>
                    {(!cr.linked_cis || cr.linked_cis.length === 0) ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <p className="text-sm text-text-secondary">연관된 CI가 없습니다.</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border-default">
                            <th className="text-left text-xs font-medium text-text-secondary py-2 pr-3">CI 이름</th>
                            <th className="text-left text-xs font-medium text-text-secondary py-2">비고</th>
                            {isPrivileged && <th className="py-2 w-8" />}
                          </tr>
                        </thead>
                        <tbody>
                          {cr.linked_cis.map((item) => (
                            <tr key={item.ci_id} className="border-b border-border-subtle">
                              <td className="py-2.5 pr-3 font-medium text-text-primary">
                                {typeof item.ci_name === 'string' ? item.ci_name : item.ci_id}
                              </td>
                              <td className="py-2.5 text-text-secondary text-xs">
                                {typeof item.notes === 'string' && item.notes ? item.notes : '-'}
                              </td>
                              {isPrivileged && (
                                <td className="py-2.5">
                                  <button
                                    type="button"
                                    title="CI 연결 해제"
                                    disabled={removeCiLinkMutation.isPending}
                                    onClick={() => removeCiLinkMutation.mutate(item.ci_id)}
                                    className="flex items-center justify-center w-6 h-6 rounded hover:bg-error-bg hover:text-error-text text-text-disabled transition-colors"
                                  >
                                    <X size={13} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* 삭제 확인 다이얼로그 */}
    <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>변경 요청 삭제</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-0">
          <p className="text-sm text-text-secondary">
            초안 변경 요청을 삭제합니다. 이 작업은 되돌릴 수 없습니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleteMutation.isPending}>
            취소
          </Button>
          <Button
            isLoading={deleteMutation.isPending}
            onClick={() => {
              setDeleteDialogOpen(false);
              deleteMutation.mutate();
            }}
            className="bg-red-500 hover:bg-red-600 text-white"
          >
            삭제
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 일정 확정 다이얼로그 */}
    <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>일정 확정</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6 pb-0">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">시작 일시</label>
            <input
              type="datetime-local"
              value={scheduledStart}
              onChange={(e) => setScheduledStart(e.target.value)}
              className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">종료 일시</label>
            <input
              type="datetime-local"
              value={scheduledEnd}
              onChange={(e) => setScheduledEnd(e.target.value)}
              className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setScheduleDialogOpen(false)} disabled={actionLoading}>
            취소
          </Button>
          <Button
            isLoading={actionLoading}
            disabled={!scheduledStart || !scheduledEnd}
            onClick={async () => {
              if (!scheduledStart || !scheduledEnd) return;
              setScheduleDialogOpen(false);
              await handleAction(
                'schedule',
                { planned_start: scheduledStart, planned_end: scheduledEnd },
                '일정이 확정되었습니다.',
              );
            }}
          >
            확정
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
