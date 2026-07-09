'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart2,
  Clock,
  Star,
  MessageSquare,
  Users,
  CheckSquare,
  Plus,
  X,
  FileText,
  ChevronRight,
  BookOpen,
  Timer,
  Target,
  Zap,
  AlertTriangle,
  Layers,
  AlertCircle,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type {
  ReportSummary,
  TicketStatus,
  TicketPriority,
  CSATSummary,
  Report,
  ReportsResponse,
  ReportStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  CHART_COLORS_LIGHT,
  CHART_BG_LIGHT,
  CATEGORY_COLORS,
  CATEGORY_BG_LIGHT,
  BRAND_PROGRESS_GRADIENT,
} from '@/lib/chart-colors';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { getUser, isTeamLeadOrAbove, isAdminRole } from '@/lib/auth';

// -----------------------------------------------------------------------
// 날짜 포맷 유틸
// -----------------------------------------------------------------------
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return dateStr;
  }
}

// -----------------------------------------------------------------------
// 기존 실시간 집계 - 상태 배지
// -----------------------------------------------------------------------
const TICKET_STATUS_STYLES: Record<TicketStatus, string> = {
  open:        'bg-status-open-bg text-status-open',
  in_progress: 'bg-purple-50 text-purple-700',
  pending:     'bg-status-pending-bg text-status-pending',
  resolved:    'bg-status-resolved-bg text-status-resolved',
  closed:      'bg-status-closed-bg text-status-closed',
};

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open:        '열림',
  in_progress: '진행 중',
  pending:     '대기',
  resolved:    '해결됨',
  closed:      '닫힘',
};

// -----------------------------------------------------------------------
// 보고서 상태 배지
// -----------------------------------------------------------------------
const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  draft:     'bg-neutral-100 text-neutral-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
};

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft:     '초안',
  submitted: '제출됨',
  approved:  '승인됨',
  rejected:  '반려됨',
};

const REPORT_TYPE_LABELS: Record<'monthly' | 'weekly', string> = {
  monthly: '월간',
  weekly:  '주간',
};

// -----------------------------------------------------------------------
// 월별 티켓 바 (간단한 인라인 차트)
// -----------------------------------------------------------------------
function MonthlyBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex-1 bg-border-subtle rounded-sm overflow-hidden" style={{ height: 6 }}>
      <div
        className="h-full rounded-sm"
        style={{
          width: `${pct}%`,
          background: BRAND_PROGRESS_GRADIENT,
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------
// CSAT KPI 카드
// -----------------------------------------------------------------------
function CsatKpiCard({
  label,
  value,
  icon,
  iconColor,
  iconBg,
  isLoading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  isLoading: boolean;
}) {
  return (
    <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 flex items-center gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: iconBg }}
      >
        <span style={{ color: iconColor }}>{icon}</span>
      </div>
      <div>
        <p className="text-xs text-text-secondary">{label}</p>
        {isLoading ? (
          <Skeleton className="h-6 w-16 mt-1" />
        ) : (
          <p className="text-xl font-bold text-text-primary tabular-nums">{value}</p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// CSAT 점수 분포 바
// -----------------------------------------------------------------------
function ScoreBar({ star, count, max }: { star: number; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary w-6 shrink-0 flex items-center gap-0.5">
        <Star size={10} className="fill-yellow-400 text-yellow-400" />
        {star}
      </span>
      <div className="flex-1 bg-border-subtle rounded-sm overflow-hidden" style={{ height: 6 }}>
        <div
          className="h-full rounded-sm"
          style={{
            width: `${pct}%`,
            background: BRAND_PROGRESS_GRADIENT,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span className="text-xs font-medium text-text-primary w-6 text-right tabular-nums">
        {count}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------
// 우선순위 색상
// -----------------------------------------------------------------------
const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-50',    text: 'text-red-600',    label: '긴급' },
  high:     { bg: 'bg-orange-50', text: 'text-orange-600', label: '높음' },
  medium:   { bg: 'bg-yellow-50', text: 'text-yellow-600', label: '보통' },
  low:      { bg: 'bg-blue-50',   text: 'text-blue-600',   label: '낮음' },
};

// -----------------------------------------------------------------------
// KPI 메트릭 카드
// -----------------------------------------------------------------------
function KpiCard({
  label,
  value,
  sub,
  icon,
  iconColor,
  iconBg,
  isLoading,
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  isLoading: boolean;
  tooltip?: string;
}) {
  return (
    <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 flex flex-col gap-2" title={tooltip}>
      <div className="flex items-center gap-2">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: iconBg }}
        >
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        <p className="text-xs text-text-secondary font-medium">{label}</p>
      </div>
      {isLoading ? (
        <Skeleton className="h-8 w-20 mt-1" />
      ) : (
        <div>
          <p className="v2-kpi-num text-text-primary">{value}</p>
          {sub && <p className="text-xs text-text-secondary mt-0.5">{sub}</p>}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// MTTR 포맷 헬퍼 (분 → "Xh Ym" 또는 "Xm")
// -----------------------------------------------------------------------
function formatMttr(minutes: number | null | undefined): string {
  if (minutes == null) return '-';
  if (minutes < 60) return `${Math.round(minutes)}분`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// -----------------------------------------------------------------------
// 보고서 목록 스켈레톤 행
// -----------------------------------------------------------------------
function ReportSkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-12" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-6" /></td>
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 보고서 생성 모달
// -----------------------------------------------------------------------
interface CreateReportModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

function CreateReportModal({ open, onClose, tenantSlug }: CreateReportModalProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [reportType, setReportType] = useState<'monthly' | 'weekly'>('monthly');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleClose() {
    setTitle('');
    setReportType('monthly');
    setPeriodStart('');
    setPeriodEnd('');
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !periodStart || !periodEnd) {
      toast.error('모든 필드를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/${tenantSlug}/reports`, {
        title: title.trim(),
        report_type: reportType,
        period_start: periodStart,
        period_end: periodEnd,
      });
      toast.success('보고서가 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['reports-list', tenantSlug] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 보고서 생성</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {/* 제목 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="보고서 제목을 입력하세요"
              className="h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* 유형 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">유형</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'monthly' | 'weekly')}
              className="h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="monthly">월간</option>
              <option value="weekly">주간</option>
            </select>
          </div>

          {/* 기간 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary">기간 시작</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary">기간 종료</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? '생성 중...' : '생성'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// 보고서 상세 Side Panel
// -----------------------------------------------------------------------
interface ReportPanelProps {
  report: Report | null;
  onClose: () => void;
  tenantSlug: string;
}

function ReportDetailPanel({ report, onClose, tenantSlug }: ReportPanelProps) {
  const queryClient = useQueryClient();
  const user = getUser();
  const userRole = user?.role;
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // panel이 닫힐 때 상태 초기화
  function handleClose() {
    setShowRejectInput(false);
    setRejectComment('');
    onClose();
  }

  // report 변경 시 reject input 초기화
  React.useEffect(() => {
    setShowRejectInput(false);
    setRejectComment('');
  }, [report?.id]);

  async function handleAction(action: 'submit' | 'approve' | 'reject') {
    if (!report) return;
    if (action === 'reject' && !rejectComment.trim()) {
      toast.error('반려 사유를 입력해주세요.');
      return;
    }
    setActionLoading(true);
    try {
      const endpoint = `/${tenantSlug}/reports/${report.id}/${action}`;
      if (action === 'reject') {
        await api.post(endpoint, { review_comment: rejectComment.trim() });
      } else {
        await api.post(endpoint);
      }
      const ACTION_LABELS = { submit: '제출', approve: '승인', reject: '반려' };
      toast.success(`보고서가 ${ACTION_LABELS[action]}되었습니다.`);
      queryClient.invalidateQueries({ queryKey: ['reports-list', tenantSlug] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  const summaryEntries = report
    ? Object.entries(report.summary_data).slice(0, 8)
    : [];

  return (
    <>
      {/* 오버레이 */}
      {report && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={handleClose}
        />
      )}

      {/* 슬라이드인 패널 */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-[420px] bg-surface border-l border-border-default shadow-xl',
          'flex flex-col transition-transform duration-200 ease-out',
          report ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {report && (
          <>
            {/* 패널 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-text-secondary" />
                <h2 className="text-sm font-semibold text-text-primary">보고서 상세</h2>
              </div>
              <button
                onClick={handleClose}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-raised transition-colors"
              >
                <X size={15} className="text-text-secondary" />
              </button>
            </div>

            {/* 패널 본문 */}
            <div className="flex-1 overflow-auto p-5 flex flex-col gap-5">
              {/* 기본 정보 */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-text-primary leading-snug">
                  {report.title}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      REPORT_STATUS_STYLES[report.status],
                    )}
                  >
                    {REPORT_STATUS_LABELS[report.status]}
                  </span>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-neutral-100 text-neutral-600">
                    {REPORT_TYPE_LABELS[report.report_type]}
                  </span>
                </div>
              </div>

              {/* 상세 필드 */}
              <div className="rounded-lg border border-border-subtle bg-surface-raised p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-text-tertiary mb-0.5">기간 시작</p>
                    <p className="text-sm text-text-primary">{formatDate(report.period_start)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-text-tertiary mb-0.5">기간 종료</p>
                    <p className="text-sm text-text-primary">{formatDate(report.period_end)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-text-tertiary mb-0.5">생성일</p>
                    <p className="text-sm text-text-primary">{formatDate(report.created_at)}</p>
                  </div>
                  {report.submitted_at && (
                    <div>
                      <p className="text-[11px] text-text-tertiary mb-0.5">제출일</p>
                      <p className="text-sm text-text-primary">{formatDate(report.submitted_at)}</p>
                    </div>
                  )}
                  {report.reviewed_at && (
                    <div>
                      <p className="text-[11px] text-text-tertiary mb-0.5">검토일</p>
                      <p className="text-sm text-text-primary">{formatDate(report.reviewed_at)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 반려 사유 */}
              {report.status === 'rejected' && report.review_comment && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-medium text-red-700 mb-1">반려 사유</p>
                  <p className="text-sm text-red-600">{report.review_comment}</p>
                </div>
              )}

              {/* summary_data */}
              {summaryEntries.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-text-secondary">요약 데이터</p>
                  <div className="rounded-lg border border-border-subtle bg-surface-raised divide-y divide-border-subtle">
                    {summaryEntries.map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-xs text-text-secondary">{key}</span>
                        <span className="text-xs font-medium text-text-primary">
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 반려 사유 입력창 (반려 버튼 클릭 후) */}
              {showRejectInput && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-text-primary">반려 사유 입력</label>
                  <textarea
                    value={rejectComment}
                    onChange={(e) => setRejectComment(e.target.value)}
                    placeholder="반려 사유를 입력해주세요..."
                    rows={3}
                    className="rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                </div>
              )}
            </div>

            {/* 패널 하단 액션 버튼 */}
            <div className="shrink-0 border-t border-border-default p-4 flex flex-col gap-2">
              {/* 제출 버튼: draft 상태 + team_lead 이상 */}
              {report.status === 'draft' && isTeamLeadOrAbove(userRole) && (
                <Button
                  className="w-full"
                  onClick={() => handleAction('submit')}
                  disabled={actionLoading}
                >
                  {actionLoading ? '처리 중...' : '제출'}
                </Button>
              )}

              {/* 승인/반려 버튼: submitted 상태 + admin */}
              {report.status === 'submitted' && isAdminRole(userRole) && (
                <>
                  <Button
                    className="w-full"
                    onClick={() => handleAction('approve')}
                    disabled={actionLoading}
                  >
                    {actionLoading ? '처리 중...' : '승인'}
                  </Button>

                  {!showRejectInput ? (
                    <Button
                      variant="outline"
                      className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => setShowRejectInput(true)}
                      disabled={actionLoading}
                    >
                      반려
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => { setShowRejectInput(false); setRejectComment(''); }}
                        disabled={actionLoading}
                      >
                        취소
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => handleAction('reject')}
                        disabled={actionLoading}
                      >
                        {actionLoading ? '처리 중...' : '반려 확인'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------
// 보고서 목록 섹션
// -----------------------------------------------------------------------
function ReportManagementSection({ tenantSlug }: { tenantSlug: string }) {
  const user = getUser();
  const userRole = user?.role;
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const { data: reportsData, isLoading: reportsLoading } = useQuery<ReportsResponse>({
    queryKey: ['reports-list', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const reports = reportsData?.items ?? [];

  return (
    <>
      {/* 보고서 관리 헤더 */}
      <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-text-secondary" />
            <h2 className="text-sm font-semibold text-text-primary">보고서 관리</h2>
            {reportsData && (
              <span className="text-xs text-text-tertiary tabular-nums">
                총 {reportsData.total}건
              </span>
            )}
          </div>
          {isTeamLeadOrAbove(userRole) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} className="mr-1" />
              새 보고서 생성
            </Button>
          )}
        </div>

        {/* 보고서 목록 테이블 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-raised">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">제목</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">기간</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">유형</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">상태</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">제출자</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary">검토일</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-text-secondary"></th>
              </tr>
            </thead>
            <tbody>
              {reportsLoading ? (
                <ReportSkeletonRows />
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-text-secondary">
                    보고서가 없습니다.
                  </td>
                </tr>
              ) : (
                reports.map((report) => (
                  <tr
                    key={report.id}
                    className="border-b border-border-subtle hover:bg-surface-raised cursor-pointer transition-colors"
                    onClick={() => setSelectedReport(report)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-text-primary line-clamp-1 max-w-[200px]">
                        {report.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {formatDate(report.period_start)} ~ {formatDate(report.period_end)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {REPORT_TYPE_LABELS[report.report_type]}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                          REPORT_STATUS_STYLES[report.status],
                        )}
                      >
                        {REPORT_STATUS_LABELS[report.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {report.submitted_by ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {formatDate(report.reviewed_at)}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded hover:bg-surface transition-colors ml-auto"
                        onClick={(e) => { e.stopPropagation(); setSelectedReport(report); }}
                      >
                        <ChevronRight size={14} className="text-text-tertiary" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 생성 모달 */}
      <CreateReportModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />

      {/* 상세 Side Panel */}
      <ReportDetailPanel
        report={selectedReport}
        onClose={() => setSelectedReport(null)}
        tenantSlug={tenantSlug}
      />
    </>
  );
}

// -----------------------------------------------------------------------
// 리포트 대시보드 페이지
// -----------------------------------------------------------------------
export default function ReportsPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;

  const { data: report, isLoading, isError, refetch } = useQuery<ReportSummary>({
    queryKey: ['reports-summary', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/reports/summary`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const { data: csat, isLoading: csatLoading } = useQuery<CSATSummary>({
    queryKey: ['csat-summary', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/csat/summary`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const monthlyTickets    = report?.monthly_tickets ?? [];
  const byStatus          = report?.by_status ?? [];
  const complianceRate    = report?.sla_compliance_rate ?? 0;
  const byPriority        = report?.by_priority ?? [];
  const mttrMinutes       = report?.mttr_minutes;
  const mttaMinutes       = report?.mtta_minutes;
  const fcrRate           = report?.fcr_rate;
  const kbTotalViews      = report?.kb_total_views ?? 0;
  const kbArticleCount    = report?.kb_article_count ?? 0;
  const kbTopArticles     = report?.kb_top_articles ?? [];
  const totalHours        = report?.total_hours ?? 0;
  const billableHours     = report?.billable_hours ?? 0;
  const ageBuckets        = report?.age_buckets;
  const channelBreakdown  = report?.channel_breakdown ?? [];
  const escalationRate    = report?.escalation_rate;
  const recurringRate     = report?.recurring_rate;
  const reopenRate        = report?.reopen_rate;

  const maxMonthlyCount = Math.max(...monthlyTickets.map((m) => m.count), 1);

  const scoreDistribution = csat?.score_distribution ?? {};
  const maxScoreCount = Math.max(
    ...([1, 2, 3, 4, 5].map((s) => scoreDistribution[String(s)] ?? 0)),
    1,
  );

  if (isError) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
          <h1 className="v2-page-title text-text-primary">리포트</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertCircle size={32} className="text-error" />
          <p className="text-sm text-text-secondary">데이터를 불러오지 못했습니다.</p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
          >
            <RefreshCw size={12} />
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="v2-page-title text-text-primary">리포트</h1>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">

        {/* ── KPI 핵심 지표 ── */}
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          <KpiCard
            label="평균 해결 시간 (MTTR)"
            value={formatMttr(mttrMinutes)}
            sub="티켓 생성→해결 평균"
            icon={<Timer size={16} />}
            iconColor={CHART_COLORS_LIGHT.brand}
            iconBg={CHART_BG_LIGHT.brand}
            isLoading={isLoading}
            tooltip="Mean Time To Resolve — 해결/종료된 티켓 기준"
          />
          <KpiCard
            label="평균 응답 시간 (MTTA)"
            value={formatMttr(mttaMinutes)}
            sub="티켓 생성→최초 응답"
            icon={<Zap size={16} />}
            iconColor={CATEGORY_COLORS.orange}
            iconBg={CATEGORY_BG_LIGHT.orange}
            isLoading={isLoading}
            tooltip="Mean Time To Acknowledge — 최초 담당자 배정 또는 댓글 기준"
          />
          <KpiCard
            label="일회 해결률 (FCR)"
            value={fcrRate != null ? `${fcrRate}%` : '-'}
            sub="에스컬레이션 없이 해결"
            icon={<Target size={16} />}
            iconColor={CHART_COLORS_LIGHT.success}
            iconBg={CHART_BG_LIGHT.success}
            isLoading={isLoading}
            tooltip="First Contact Resolution — 에스컬레이션 없이 해결된 티켓 비율"
          />
          <KpiCard
            label="SLA 준수율"
            value={`${(complianceRate * 100).toFixed(1)}%`}
            sub={`위반 ${report?.sla_breach_count ?? 0}건`}
            icon={<Clock size={16} />}
            iconColor={CHART_COLORS_LIGHT.info}
            iconBg={CHART_BG_LIGHT.info}
            isLoading={isLoading}
          />
          <KpiCard
            label="에스컬레이션율"
            value={escalationRate != null ? `${escalationRate}%` : '-'}
            sub="전체 대비 에스컬레이션"
            icon={<AlertTriangle size={16} />}
            iconColor={CHART_COLORS_LIGHT.danger}
            iconBg={CHART_BG_LIGHT.danger}
            isLoading={isLoading}
            tooltip="에스컬레이션된 티켓 / 전체 티켓 비율"
          />
          <KpiCard
            label="반복 장애율"
            value={recurringRate != null ? `${recurringRate}%` : '-'}
            sub="반복 장애 감지 티켓"
            icon={<Layers size={16} />}
            iconColor={CATEGORY_COLORS.violet}
            iconBg={CATEGORY_BG_LIGHT.violet}
            isLoading={isLoading}
            tooltip="동일 증상 반복 감지된 티켓 비율"
          />
        </div>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          <KpiCard
            label="이번 달 해결"
            value={String(report?.monthly_resolved ?? 0)}
            sub="resolved + closed"
            icon={<CheckSquare size={16} />}
            iconColor={CATEGORY_COLORS.purple}
            iconBg={CATEGORY_BG_LIGHT.purple}
            isLoading={isLoading}
          />
          <KpiCard
            label="KB 조회수"
            value={kbTotalViews.toLocaleString()}
            sub={`게시 문서 ${kbArticleCount}건`}
            icon={<BookOpen size={16} />}
            iconColor={CHART_COLORS_LIGHT.brand}
            iconBg={CHART_BG_LIGHT.brand}
            isLoading={isLoading}
          />
          <KpiCard
            label="총 공수"
            value={`${totalHours}h`}
            sub={`청구 ${billableHours}h`}
            icon={<Layers size={16} />}
            iconColor={CATEGORY_COLORS.slate}
            iconBg={CATEGORY_BG_LIGHT.slate}
            isLoading={isLoading}
          />
          <KpiCard
            label="재오픈율 (Reopen)"
            value={reopenRate != null ? `${reopenRate}%` : '-'}
            sub={`재오픈 ${report?.reopen_ticket_count ?? 0}건`}
            icon={<RotateCcw size={16} />}
            iconColor={CHART_COLORS_LIGHT.danger}
            iconBg={CHART_BG_LIGHT.danger}
            isLoading={isLoading}
            tooltip="해결 후 다시 열린 티켓 비율 — 재작업/품질 지표"
          />
        </div>

        {/* 보고서 관리 섹션 */}
        {tenantSlug && <ReportManagementSection tenantSlug={tenantSlug} />}

        {/* 2컬럼 */}
        <div className="grid grid-cols-2 gap-6">
          {/* 월별 티켓 추세 */}
          <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
              <BarChart2 size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">월별 티켓 생성</h2>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : monthlyTickets.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">데이터가 없습니다.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {monthlyTickets.map((m) => (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="text-xs text-text-secondary w-14 shrink-0">{m.month}</span>
                      <MonthlyBar count={m.count} max={maxMonthlyCount} />
                      <span className="text-xs font-medium text-text-primary w-8 text-right tabular-nums">
                        {m.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 상태별 분포 + SLA 준수율 */}
          <div className="flex flex-col gap-4">
            {/* 상태별 분포 */}
            <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
              <div className="px-5 py-4 border-b border-border-subtle">
                <h2 className="text-sm font-semibold text-text-primary">상태별 티켓 분포</h2>
              </div>
              <div className="p-5">
                {isLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full rounded-lg" />
                    ))}
                  </div>
                ) : byStatus.length === 0 ? (
                  <p className="text-sm text-text-secondary text-center py-4">데이터가 없습니다.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {byStatus.map(({ status, count }) => (
                      <div
                        key={status}
                        className="rounded-lg border border-border-subtle p-3 flex flex-col gap-1"
                      >
                        <span
                          className={cn(
                            'inline-flex items-center self-start rounded-full px-2 py-0.5 text-[10px] font-medium',
                            TICKET_STATUS_STYLES[status as TicketStatus],
                          )}
                        >
                          {TICKET_STATUS_LABELS[status as TicketStatus] ?? status}
                        </span>
                        <span className="text-2xl font-bold text-text-primary tabular-nums">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* SLA 준수율 카드 */}
            <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-5 flex items-center gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{ background: CHART_BG_LIGHT.success }}
              >
                <Clock size={20} style={{ color: CHART_COLORS_LIGHT.success }} />
              </div>
              <div>
                <p className="text-xs text-text-secondary">SLA 준수율</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-20 mt-1" />
                ) : (
                  <p className="v2-kpi-num text-text-primary mt-0.5">
                    {complianceRate.toFixed(1)}
                    <span className="text-lg font-medium text-text-secondary ml-0.5">%</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 우선순위 분포 + KB Top 아티클 ── */}
        <div className="grid grid-cols-2 gap-6">
          {/* 우선순위별 분포 */}
          <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
              <AlertTriangle size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">우선순위별 분포</h2>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                </div>
              ) : byPriority.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">데이터가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {(['critical', 'high', 'medium', 'low'] as TicketPriority[]).map((p) => {
                    const item = byPriority.find((b) => b.priority === p);
                    const c = PRIORITY_COLORS[p];
                    return (
                      <div key={p} className={`rounded-lg border border-border-subtle p-3 flex flex-col gap-1 ${c.bg}`}>
                        <span className={`text-[10px] font-medium ${c.text}`}>{c.label}</span>
                        <span className="text-2xl font-bold text-text-primary tabular-nums">{item?.count ?? 0}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* KB 인기 문서 Top 5 */}
          <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
              <BookOpen size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">KB 인기 문서</h2>
              {!isLoading && kbArticleCount > 0 && (
                <span className="text-xs text-text-tertiary ml-auto">총 {kbArticleCount}건 · {kbTotalViews.toLocaleString()}회</span>
              )}
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : kbTopArticles.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">게시된 문서가 없습니다.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border-subtle">
                  {kbTopArticles.map((art, idx) => (
                    <div key={art.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-xs font-bold text-text-tertiary w-4 shrink-0 tabular-nums">{idx + 1}</span>
                      <span className="flex-1 text-sm text-text-primary line-clamp-1">{art.title}</span>
                      <span className="text-xs text-text-tertiary tabular-nums shrink-0">{art.view_count.toLocaleString()}회</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 채널별 분포 + 티켓 연령 구간 ── */}
        <div className="grid grid-cols-2 gap-6">
          {/* 채널별 분포 */}
          <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
              <MessageSquare size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">채널별 분포</h2>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="flex flex-col gap-3">
                  {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : channelBreakdown.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">데이터가 없습니다.</p>
              ) : (() => {
                const maxCh = Math.max(...channelBreakdown.map((c) => c.count), 1);
                const CHANNEL_LABELS: Record<string, string> = {
                  email: '이메일', phone: '전화', portal: '포털', internal: '내부',
                };
                return (
                  <div className="flex flex-col gap-3">
                    {channelBreakdown.map((ch) => (
                      <div key={ch.channel} className="flex items-center gap-3">
                        <span className="text-xs text-text-secondary w-14 shrink-0">
                          {CHANNEL_LABELS[ch.channel] ?? ch.channel}
                        </span>
                        <MonthlyBar count={ch.count} max={maxCh} />
                        <span className="text-xs font-medium text-text-primary w-8 text-right tabular-nums">
                          {ch.count}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* 티켓 연령 구간 (미해결) */}
          <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
              <Clock size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">티켓 연령 구간</h2>
              <span className="text-xs text-text-tertiary ml-auto">미해결 티켓 기준</span>
            </div>
            <div className="p-5">
              {isLoading ? (
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
                </div>
              ) : !ageBuckets ? (
                <p className="text-sm text-text-secondary text-center py-8">데이터가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { key: '0-7d', label: '7일 이내', color: 'text-green-600', bg: 'bg-green-50' },
                    { key: '7-30d', label: '7~30일', color: 'text-yellow-600', bg: 'bg-yellow-50' },
                    { key: '30d+', label: '30일 초과', color: 'text-red-600', bg: 'bg-red-50' },
                  ].map(({ key, label, color, bg }) => (
                    <div key={key} className={`rounded-lg border border-border-subtle p-3 flex flex-col gap-1 ${bg}`}>
                      <span className={`text-[10px] font-medium ${color}`}>{label}</span>
                      <span className="text-2xl font-bold text-text-primary tabular-nums">
                        {ageBuckets[key as keyof typeof ageBuckets] ?? 0}
                      </span>
                      <span className="text-[10px] text-text-tertiary">건</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CSAT 섹션 */}
        <div className="bg-surface border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border-subtle">
            <Star size={16} className="text-text-secondary" />
            <h2 className="text-sm font-semibold text-text-primary">고객 만족도 (CSAT)</h2>
          </div>
          <div className="p-5 flex flex-col gap-5">
            {/* KPI 4개 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CsatKpiCard
                label="평균 점수"
                value={
                  csat?.avg_score != null
                    ? `${csat.avg_score.toFixed(1)} / 5`
                    : '데이터 없음'
                }
                icon={<Star size={18} />}
                iconColor={CHART_COLORS_LIGHT.brand}
                iconBg={CHART_BG_LIGHT.brand}
                isLoading={csatLoading}
              />
              <CsatKpiCard
                label="응답률"
                value={csat != null ? `${(csat.response_rate * 100).toFixed(1)}%` : '-'}
                icon={<CheckSquare size={18} />}
                iconColor={CHART_COLORS_LIGHT.success}
                iconBg={CHART_BG_LIGHT.success}
                isLoading={csatLoading}
              />
              <CsatKpiCard
                label="총 설문 수"
                value={csat != null ? String(csat.total) : '-'}
                icon={<Users size={18} />}
                iconColor={CHART_COLORS_LIGHT.info}
                iconBg={CHART_BG_LIGHT.info}
                isLoading={csatLoading}
              />
              <CsatKpiCard
                label="제출 수"
                value={csat != null ? String(csat.submitted) : '-'}
                icon={<MessageSquare size={18} />}
                iconColor={CATEGORY_COLORS.violet}
                iconBg={CATEGORY_BG_LIGHT.violet}
                isLoading={csatLoading}
              />
            </div>

            {/* 점수 분포 + 월별 추이 2컬럼 */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {/* 점수 분포 */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-text-secondary">점수 분포</p>
                {csatLoading ? (
                  <div className="flex flex-col gap-2">
                    {[5, 4, 3, 2, 1].map((s) => (
                      <Skeleton key={s} className="h-4 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {[5, 4, 3, 2, 1].map((s) => (
                      <ScoreBar
                        key={s}
                        star={s}
                        count={scoreDistribution[String(s)] ?? 0}
                        max={maxScoreCount}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* 월별 CSAT 추이 */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-text-secondary">월별 평균 점수 추이</p>
                {csatLoading ? (
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                ) : !csat?.monthly_trend || csat.monthly_trend.length === 0 ? (
                  <p className="text-sm text-text-secondary text-center py-4">데이터가 없습니다.</p>
                ) : (() => {
                  const trend = csat.monthly_trend!;
                  const maxScore = 5;
                  return (
                    <div className="flex flex-col gap-2">
                      {trend.map((t) => (
                        <div key={t.month} className="flex items-center gap-3">
                          <span className="text-xs text-text-secondary w-14 shrink-0">{t.month}</span>
                          <div className="flex-1 bg-border-subtle rounded-sm overflow-hidden" style={{ height: 6 }}>
                            <div
                              className="h-full rounded-sm"
                              style={{
                                width: `${(t.avg_score / maxScore) * 100}%`,
                                background: BRAND_PROGRESS_GRADIENT,
                                transition: 'width 0.4s ease',
                              }}
                            />
                          </div>
                          <span className="text-xs font-medium text-text-primary w-12 text-right tabular-nums">
                            {t.avg_score.toFixed(1)} <span className="text-text-tertiary">({t.count})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
