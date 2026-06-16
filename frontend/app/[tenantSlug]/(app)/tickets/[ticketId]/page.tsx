'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Send } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type { Ticket, TicketComment, EscalationOut, TicketPriority, TicketStatus } from '@/lib/types';
import { cn, formatRelativeTime } from '@/lib/utils';
import { SlaBadge } from '@/components/tickets/SlaBadge';
import { EscalationEventCard } from '@/components/tickets/EscalationEventCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// WorkLog 인라인 타입 정의
// -----------------------------------------------------------------------
interface WorkLog {
  id: string;
  user_id: string;
  user_name?: string;
  work_type: string;
  hours: number;
  billable: boolean;
  memo: string | null;
  logged_at: string;
}

// -----------------------------------------------------------------------
// 배지 설정
// -----------------------------------------------------------------------
const STATUS_LABELS: Record<TicketStatus, string> = {
  open:        '열림',
  in_progress: '진행 중',
  pending:     '대기',
  resolved:    '해결됨',
  closed:      '닫힘',
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  open:        'bg-info-bg text-info-text',
  in_progress: 'bg-warning-bg text-warning-text',
  pending:     'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  resolved:    'bg-success-bg text-success-text',
  closed:      'bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low:      '낮음',
  medium:   '보통',
  high:     '높음',
  critical: '긴급',
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low:      'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
  medium:   'bg-info-bg text-info-text',
  high:     'bg-warning-bg text-warning-text',
  critical: 'bg-error-bg text-error-text',
};

// -----------------------------------------------------------------------
// SLA 섹션 남은 시간 표시 헬퍼
// -----------------------------------------------------------------------
function SlaTimeDisplay({ deadline, label }: { deadline: string | null | undefined; label: string }) {
  if (!deadline) {
    return (
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-disabled">미설정</span>
      </div>
    );
  }

  const ms = new Date(deadline).getTime() - Date.now();
  const isBreached = ms <= 0;
  const isWarning = !isBreached && ms < 2 * 60 * 60 * 1000;

  let timeText = '';
  if (isBreached) {
    timeText = '초과';
  } else {
    const totalMin = Math.floor(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h >= 24) {
      const d = Math.floor(h / 24);
      const rh = h % 24;
      timeText = rh > 0 ? `${d}일 ${rh}h` : `${d}일`;
    } else if (h > 0) {
      timeText = `${h}h ${m}m`;
    } else {
      timeText = `${m}m`;
    }
  }

  return (
    <div className="flex justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span
        className={cn(
          'font-medium',
          isBreached ? 'text-error-text' : isWarning ? 'text-warning-text' : 'text-success-text',
        )}
      >
        {timeText}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------
// 댓글 버블
// -----------------------------------------------------------------------
function CommentBubble({ comment }: { comment: TicketComment }) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 text-sm',
        comment.is_internal
          ? 'bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/30'
          : 'bg-surface-elevated',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary">{comment.author_name}</span>
          {comment.is_internal && (
            <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              내부 메모
            </span>
          )}
        </div>
        <span className="text-xs text-text-secondary">{formatRelativeTime(comment.created_at)}</span>
      </div>
      <p className="text-text-primary whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
}

// -----------------------------------------------------------------------
// 사이드바 섹션 래퍼
// -----------------------------------------------------------------------
function SideSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------
// 활동 타임라인 아이템
// -----------------------------------------------------------------------
type ActivityItem =
  | { kind: 'comment'; timestamp: string; data: TicketComment }
  | { kind: 'escalation'; timestamp: string; data: EscalationOut };

// -----------------------------------------------------------------------
// 페이지 스켈레톤
// -----------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 max-w-6xl mx-auto">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-[1fr_20rem] gap-6 mt-4">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 풀 페이지 컴포넌트
// -----------------------------------------------------------------------
export default function TicketDetailPage() {
  const params = useParams<{ tenantSlug: string; ticketId: string }>();
  const tenantSlug = params.tenantSlug;
  const ticketId = params.ticketId;

  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = React.useState('');
  const [isInternal, setIsInternal] = React.useState(false);

  // 티켓 상세 조회
  const { data: ticketDetail, isLoading: ticketLoading } = useQuery<{
    ticket: Ticket;
    comments: TicketComment[];
  }>({
    queryKey: ['ticket-detail-full', tenantSlug, ticketId],
    queryFn: async () => {
      const r = await api.get(`/${tenantSlug}/tickets/${ticketId}`);
      // API가 { ticket, comments } 형태로 반환하거나 단순 Ticket 반환
      const d = r.data;
      if (d?.ticket) return d as { ticket: Ticket; comments: TicketComment[] };
      // 단순 Ticket 형태인 경우 래핑
      return { ticket: d as Ticket, comments: [] };
    },
    staleTime: 30 * 1000,
    enabled: !!ticketId,
  });

  // 댓글 별도 fetch (API가 단순 Ticket만 반환하는 경우를 대비)
  const { data: commentsData } = useQuery<TicketComment[]>({
    queryKey: ['ticket-comments', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/comments`).then((r) => {
        const d = r.data;
        if (Array.isArray(d)) return d;
        if (Array.isArray(d?.items)) return d.items;
        return [];
      }),
    enabled: !!ticketId,
    staleTime: 30 * 1000,
  });

  // 에스컬레이션 이벤트
  const { data: escalations = [] } = useQuery<EscalationOut[]>({
    queryKey: ['escalations', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/escalations`).then((r) => {
        const d = r.data;
        if (Array.isArray(d)) return d;
        if (Array.isArray(d?.items)) return d.items;
        return [];
      }),
    enabled: !!ticketId,
    staleTime: 30 * 1000,
  });

  // 공수 (work-logs)
  const { data: workLogsData } = useQuery<{ items: WorkLog[] } | WorkLog[]>({
    queryKey: ['work-logs', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/work-logs`).then((r) => r.data),
    enabled: !!ticketId,
    staleTime: 30 * 1000,
  });

  const ticket = ticketDetail?.ticket;

  // 댓글: API 응답 우선, 없으면 ticketDetail.comments 폴백
  const comments: TicketComment[] =
    commentsData ??
    ticketDetail?.comments ??
    [];

  // 공수 배열 정규화
  const workLogs: WorkLog[] = Array.isArray(workLogsData)
    ? workLogsData
    : workLogsData?.items ?? [];

  // 총 공수 합산
  const totalHours = workLogs.reduce((acc, l) => acc + l.hours, 0);

  // 활동 타임라인 병합 (댓글 + 에스컬레이션)
  const activityItems: ActivityItem[] = React.useMemo(() => {
    const items: ActivityItem[] = [
      ...comments.map((c) => ({
        kind: 'comment' as const,
        timestamp: c.created_at,
        data: c,
      })),
      ...escalations.map((e) => ({
        kind: 'escalation' as const,
        timestamp: e.created_at,
        data: e,
      })),
    ];
    return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [comments, escalations]);

  // 댓글 작성 mutation
  const commentMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/tickets/${ticketId}/comments`, {
        body: commentBody,
        is_internal: isInternal,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-comments', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['ticket-detail-full', tenantSlug, ticketId] });
      setCommentBody('');
      setIsInternal(false);
      toast.success('댓글이 등록되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (ticketLoading) return <PageSkeleton />;

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-secondary">
        <p className="text-sm">티켓을 찾을 수 없습니다.</p>
        <Link href={`/${tenantSlug}/tickets`} className="text-sm text-brand hover:underline">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const slaGrade = ticket.sla_response_deadline ? undefined : undefined; // 사이드바에서 SlaBadge 사용

  return (
    <div className="min-h-full bg-bg">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* 상단 뒤로가기 */}
        <div className="mb-4">
          <Link
            href={`/${tenantSlug}/tickets`}
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={14} />
            목록으로
          </Link>
        </div>

        {/* 티켓 헤더 */}
        <div className="mb-6">
          {ticket.ticket_number && (
            <p className="text-xs font-mono text-text-secondary mb-1">{ticket.ticket_number}</p>
          )}
          <h1 className="text-xl font-bold text-text-primary leading-snug mb-3">
            {ticket.title}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                STATUS_STYLES[ticket.status],
              )}
            >
              {STATUS_LABELS[ticket.status]}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                PRIORITY_STYLES[ticket.priority],
              )}
            >
              {PRIORITY_LABELS[ticket.priority]}
            </span>
            {ticket.escalation_level != null && ticket.escalation_level > 1 && (
              <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">
                {ticket.escalation_level}차 대응
              </span>
            )}
            <SlaBadge deadline={ticket.sla_response_deadline} label="응답" />
            <SlaBadge deadline={ticket.sla_resolution_deadline} label="해결" />
          </div>
        </div>

        {/* 2컬럼 레이아웃 */}
        <div className="grid grid-cols-[1fr_20rem] gap-6 items-start">
          {/* ── 왼쪽: 본문 + 활동 타임라인 ── */}
          <div className="flex flex-col gap-6 min-w-0">
            {/* 설명 */}
            {ticket.description && (
              <div className="rounded-lg border border-border-default bg-surface p-5">
                <h2 className="text-sm font-semibold text-text-secondary mb-3">설명</h2>
                <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                  {ticket.description}
                </p>
              </div>
            )}

            {/* 활동 타임라인 */}
            <div className="rounded-lg border border-border-default bg-surface">
              <div className="px-5 py-3 border-b border-border-default">
                <h2 className="text-sm font-semibold text-text-primary">활동</h2>
              </div>

              <div className="p-4 flex flex-col gap-3">
                {activityItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-text-secondary">
                    <p className="text-sm">아직 활동 내역이 없습니다.</p>
                  </div>
                ) : (
                  activityItems.map((item) =>
                    item.kind === 'comment' ? (
                      <CommentBubble key={`c-${item.data.id}`} comment={item.data} />
                    ) : (
                      <EscalationEventCard
                        key={`e-${item.data.id}`}
                        esc={item.data}
                        ticketId={ticketId}
                        tenantSlug={tenantSlug}
                        onAcknowledged={() => {
                          queryClient.invalidateQueries({
                            queryKey: ['escalations', tenantSlug, ticketId],
                          });
                        }}
                      />
                    ),
                  )
                )}
              </div>

              {/* 댓글 입력 */}
              <div className="border-t border-border-default p-4">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="메시지를 입력하세요..."
                  rows={3}
                  className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (commentBody.trim()) commentMutation.mutate();
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isInternal}
                      onChange={(e) => setIsInternal(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border-strong accent-brand cursor-pointer"
                    />
                    <span className="text-xs text-text-secondary">내부 메모</span>
                  </label>
                  <Button
                    size="sm"
                    onClick={() => { if (commentBody.trim()) commentMutation.mutate(); }}
                    isLoading={commentMutation.isPending}
                    disabled={!commentBody.trim()}
                    leftIcon={<Send size={12} />}
                  >
                    전송
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* ── 오른쪽 사이드바 ── */}
          <div className="flex flex-col gap-4">
            {/* 고객 / 계약 */}
            <SideSection title="고객 정보">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">고객</span>
                  {ticket.customer_name ? (
                    <span className="text-text-primary font-medium">{ticket.customer_name}</span>
                  ) : (
                    <span className="text-text-disabled">미연결</span>
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">계약</span>
                  {ticket.contract_id ? (
                    <span className="text-text-primary font-medium">{ticket.contract_id}</span>
                  ) : (
                    <span className="text-text-disabled">없음</span>
                  )}
                </div>
              </div>
            </SideSection>

            {/* SLA 현황 */}
            <SideSection title="SLA 현황">
              <SlaTimeDisplay deadline={ticket.sla_response_deadline} label="응답 마감" />
              <SlaTimeDisplay deadline={ticket.sla_resolution_deadline} label="해결 마감" />
            </SideSection>

            {/* 담당자 */}
            <SideSection title="담당자">
              <div className="text-sm">
                {ticket.assignee_name ? (
                  <span className="text-text-primary">{ticket.assignee_name}</span>
                ) : (
                  <span className="text-text-disabled">미배정</span>
                )}
              </div>
            </SideSection>

            {/* 공수 요약 */}
            <SideSection title="공수">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">총 투입 시간</span>
                <span className="text-text-primary font-semibold tabular-nums">
                  {totalHours > 0 ? `${totalHours.toFixed(1)}h` : '-'}
                </span>
              </div>
            </SideSection>

            {/* 날짜 정보 */}
            <SideSection title="일시">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">생성</span>
                  <span className="text-text-primary text-xs">
                    {new Date(ticket.created_at).toLocaleString('ko-KR')}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">수정</span>
                  <span className="text-text-primary text-xs">
                    {new Date(ticket.updated_at).toLocaleString('ko-KR')}
                  </span>
                </div>
                {ticket.resolved_at && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">해결</span>
                    <span className="text-text-primary text-xs">
                      {new Date(ticket.resolved_at).toLocaleString('ko-KR')}
                    </span>
                  </div>
                )}
              </div>
            </SideSection>
          </div>
        </div>
      </div>
    </div>
  );
}
