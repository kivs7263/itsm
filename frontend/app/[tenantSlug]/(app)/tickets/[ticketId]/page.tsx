'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, BookOpen,
  CirclePlus, RefreshCw, UserCheck, AlertTriangle,
  MessageSquare, Clock, TrendingUp, CheckCircle2, XCircle,
  RotateCcw, FileText, Play,
  X, Link2, UserMinus,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { issuePortalLink, formatPortalExpiry } from '@/lib/portalLink';
import type { Ticket, TicketComment, EscalationOut, TicketPriority, TicketStatus, KnownIssue, TicketWithRequester } from '@/lib/types';
import { cn, formatRelativeTime } from '@/lib/utils';
import { SlaBadge } from '@/components/tickets/SlaBadge';
import { EscalationEventCard } from '@/components/tickets/EscalationEventCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WorkLogStopModal } from '@/components/tickets/WorkLogStopModal';
import { CreateKbModal } from '@/components/kb/CreateKbModal';

// -----------------------------------------------------------------------
// 타이머 타입 + elapsed 훅
// -----------------------------------------------------------------------
interface TimerActiveItem {
  ticket_id: string;
  ticket_number: string | null;
  ticket_title: string | null;
  started_at: string;
  elapsed_seconds: number;
}

function useElapsed(startedAt: string | null, active: boolean): string {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!active || !startedAt) { setElapsed(0); return; }
    const base = Date.now() - new Date(startedAt).getTime();
    setElapsed(Math.floor(base / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
  pending:     'bg-neutral-100 text-neutral-600',
  resolved:    'bg-success-bg text-success-text',
  closed:      'bg-neutral-200 text-neutral-500',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low:      '낮음',
  medium:   '보통',
  high:     '높음',
  critical: '긴급',
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low:      'bg-neutral-100 text-neutral-500',
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
          ? 'bg-amber-50 border border-amber-200'
          : 'bg-surface-elevated',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary">{comment.author_name}</span>
          {comment.is_internal && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
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
    <div className="rounded-lg border border-border-default shadow-[var(--shadow-card)] bg-surface p-4 flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------
// 활동 감사 이벤트 타입
// -----------------------------------------------------------------------
interface ActivityEvent {
  id: string;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  meta: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

const EVENT_CONFIG: Record<string, { label: (e: ActivityEvent) => string; icon: React.ReactNode; color: string }> = {
  created:                { label: () => '티켓이 생성되었습니다', icon: <CirclePlus size={13} />, color: 'text-info-text bg-info-bg' },
  status_changed:         { label: (e) => `상태: ${e.from_value ?? '-'} → ${e.to_value ?? '-'}`, icon: <RefreshCw size={13} />, color: 'text-warning-text bg-warning-bg' },
  priority_changed:       { label: (e) => `우선순위: ${e.from_value ?? '-'} → ${e.to_value ?? '-'}`, icon: <TrendingUp size={13} />, color: 'text-warning-text bg-warning-bg' },
  assigned:               { label: (e) => e.to_value ? `담당자가 배정되었습니다` : '담당자가 해제되었습니다', icon: <UserCheck size={13} />, color: 'text-success-text bg-success-bg' },
  comment_added:          { label: () => '댓글이 추가되었습니다', icon: <MessageSquare size={13} />, color: 'text-text-secondary bg-surface-elevated' },
  work_log_added:         { label: (e) => `공수 ${(e.meta?.hours as number | undefined)?.toFixed(1) ?? '?'}h 기록됨`, icon: <Clock size={13} />, color: 'text-info-text bg-info-bg' },
  escalated:              { label: (e) => `${e.from_value ?? '?'}차 → ${e.to_value ?? '?'}차 에스컬레이션`, icon: <AlertTriangle size={13} />, color: 'text-error-text bg-error-bg' },
  sla_response_breached:  { label: () => 'SLA 응답 기한 초과', icon: <AlertTriangle size={13} />, color: 'text-error-text bg-error-bg' },
  sla_resolution_breached:{ label: () => 'SLA 해결 기한 초과', icon: <AlertTriangle size={13} />, color: 'text-error-text bg-error-bg' },
  resolved:               { label: () => '티켓이 해결 처리되었습니다', icon: <CheckCircle2 size={13} />, color: 'text-success-text bg-success-bg' },
  closed:                 { label: () => '티켓이 종료되었습니다', icon: <XCircle size={13} />, color: 'text-text-secondary bg-surface-elevated' },
  reopened:               { label: () => '티켓이 재오픈되었습니다', icon: <RotateCcw size={13} />, color: 'text-warning-text bg-warning-bg' },
  kb_draft_created:       { label: () => 'KB 초안이 생성되었습니다', icon: <FileText size={13} />, color: 'text-success-text bg-success-bg' },
};

function SystemEventRow({ event }: { event: ActivityEvent }) {
  const cfg = EVENT_CONFIG[event.event_type] ?? {
    label: (e: ActivityEvent) => e.event_type,
    icon: <RefreshCw size={13} />,
    color: 'text-text-secondary bg-surface-elevated',
  };
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0', cfg.color)}>
        {cfg.icon}
        <span>{cfg.label(event)}</span>
      </span>
      {event.actor_name && (
        <span className="text-xs text-text-secondary shrink-0">by {event.actor_name}</span>
      )}
      <span className="text-xs text-text-disabled ml-auto shrink-0">{formatRelativeTime(event.created_at)}</span>
    </div>
  );
}

// -----------------------------------------------------------------------
// 활동 타임라인 아이템
// -----------------------------------------------------------------------
type ActivityItem =
  | { kind: 'comment'; timestamp: string; data: TicketComment }
  | { kind: 'escalation'; timestamp: string; data: EscalationOut }
  | { kind: 'system'; timestamp: string; data: ActivityEvent };

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
  const [kbModalOpen, setKbModalOpen] = React.useState(false);
  const [isInternal, setIsInternal] = React.useState(false);
  const [showStopModal, setShowStopModal] = React.useState(false);
  const [showOtherTimerModal, setShowOtherTimerModal] = React.useState(false);
  const [kiLinkOpen, setKiLinkOpen] = React.useState(false);
  const prevStatusRef = React.useRef<string | null>(null);

  // 티켓 상세 조회
  const { data: ticketDetail, isLoading: ticketLoading, isError: ticketError, refetch: refetchTicket } = useQuery<{
    ticket: TicketWithRequester;
    comments: TicketComment[];
  }>({
    queryKey: ['ticket-detail-full', tenantSlug, ticketId],
    queryFn: async () => {
      const r = await api.get(`/${tenantSlug}/tickets/${ticketId}`);
      // API가 { ticket, comments } 형태로 반환하거나 단순 Ticket 반환
      const d = r.data;
      if (d?.ticket) return d as { ticket: TicketWithRequester; comments: TicketComment[] };
      // 단순 Ticket 형태인 경우 래핑
      return { ticket: d as TicketWithRequester, comments: [] };
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

  // 활동 감사 로그
  const { data: activities = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['ticket-activities', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/activities`).then((r) => {
        const d = r.data;
        return Array.isArray(d) ? d : [];
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
  const { data: workLogsData } = useQuery<{ items: WorkLog[]; total: number }>({
    queryKey: ['work-logs', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/work-logs`).then((r) => r.data),
    enabled: !!ticketId,
    staleTime: 30 * 1000,
  });

  // 알려진 이슈 — 티켓에 연결된 목록 (bare list)
  const { data: linkedKisRaw = [] } = useQuery<KnownIssue[]>({
    queryKey: ['ticket-known-issues', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/known-issues`).then((r) => {
        const d = r.data;
        return Array.isArray(d) ? d : (d?.items ?? []);
      }),
    enabled: !!ticketId,
    staleTime: 30 * 1000,
  });

  // 알려진 이슈 — 전체 목록 (연결 모달용, 모달 열릴 때만 fetch)
  const { data: allKisRaw = [], isLoading: allKisLoading } = useQuery<KnownIssue[]>({
    queryKey: ['all-known-issues', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/kb/known-issues`).then((r) => {
        const d = r.data;
        return Array.isArray(d) ? d : (d?.items ?? []);
      }),
    enabled: kiLinkOpen,
    staleTime: 60 * 1000,
  });

  const ticket = ticketDetail?.ticket;

  // 상태가 resolved로 바뀌면 KB 모달 자동 오픈 (한 번만)
  React.useEffect(() => {
    if (ticket?.status === 'resolved' && prevStatusRef.current !== null && prevStatusRef.current !== 'resolved') {
      setKbModalOpen(true);
    }
    if (ticket?.status) {
      prevStatusRef.current = ticket.status;
    }
  }, [ticket?.status]);

  // 댓글: API 응답 우선, 없으면 ticketDetail.comments 폴백
  const comments: TicketComment[] =
    commentsData ??
    ticketDetail?.comments ??
    [];

  // 공수 배열 정규화
  const workLogs: WorkLog[] = workLogsData?.items ?? [];

  // 총 공수 합산
  const totalHours = workLogs.reduce((acc, l) => acc + l.hours, 0);
  const billableHours = workLogs.reduce((acc, l) => acc + (l.billable ? l.hours : 0), 0);

  // 활동 타임라인 병합 (시스템 이벤트 + 댓글 + 에스컬레이션)
  // comment_added는 댓글 버블로 표시하므로 activities에서 제외
  // escalated는 EscalationEventCard로 표시하므로 activities에서 제외
  const SYSTEM_ONLY = new Set(['created', 'status_changed', 'priority_changed', 'assigned', 'work_log_added',
    'sla_response_breached', 'sla_resolution_breached', 'resolved', 'closed', 'reopened', 'kb_draft_created']);

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
      ...activities
        .filter((a) => SYSTEM_ONLY.has(a.event_type))
        .map((a) => ({
          kind: 'system' as const,
          timestamp: a.created_at,
          data: a,
        })),
    ];
    return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, escalations, activities]);

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
      queryClient.invalidateQueries({ queryKey: ['ticket-activities', tenantSlug, ticketId] });
      setCommentBody('');
      setIsInternal(false);
      toast.success('댓글이 등록되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // BUG-ITSM-003: 상태 변경 mutation (상세 페이지)
  const statusMutation = useMutation({
    mutationFn: (newStatus: TicketStatus) =>
      api.patch(`/${tenantSlug}/tickets/${ticketId}`, { status: newStatus }),
    onSuccess: (_, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-detail-full', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['ticket-activities', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      toast.success('상태가 변경되었습니다.');
      if (newStatus === 'resolved' && ticketId) {
        toast('이 해결 과정을 KB 문서로 만드세요', {
          description: 'AI가 티켓 내용으로 초안을 자동 생성합니다.',
          action: {
            label: 'KB 작성',
            onClick: () => { window.open(`/${tenantSlug}/kb?from_ticket=${ticketId}`, '_blank'); },
          },
          duration: 8000,
        });
      }
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // BUG-ITSM-004: 타이머 쿼리 (상세 페이지)
  const { data: timers = [] } = useQuery<TimerActiveItem[]>({
    queryKey: ['work-timer', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/work-logs/timer/active`).then((r) => r.data),
    refetchInterval: 10000,
  });

  const myTimer = timers.find((t) => t.ticket_id === ticketId);
  const otherTimers = timers.filter((t) => t.ticket_id !== ticketId);
  const elapsed = useElapsed(myTimer?.started_at ?? null, !!myTimer);
  const otherElapsed = useElapsed(otherTimers[0]?.started_at ?? null, otherTimers.length > 0);

  const startTimerMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/work-logs/timer/start?ticket_id=${ticketId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-timer', tenantSlug] });
      toast.success('타이머가 시작되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function handleStartTimer() {
    if (otherTimers.length > 0) {
      setShowOtherTimerModal(true);
      return;
    }
    startTimerMutation.mutate();
  }

  // KI 연결
  const linkKiMutation = useMutation({
    mutationFn: (articleId: string) =>
      api.post(`/${tenantSlug}/tickets/${ticketId}/known-issues`, { article_id: articleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-known-issues', tenantSlug, ticketId] });
      toast.success('알려진 이슈가 연결되었습니다.');
      setKiLinkOpen(false);
    },
    onError: (err) => {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        toast.error('이미 연결된 알려진 이슈입니다.');
        return;
      }
      toast.error(getErrorMessage(err));
    },
  });

  // KI 연결 해제
  const unlinkKiMutation = useMutation({
    mutationFn: (articleId: string) =>
      api.delete(`/${tenantSlug}/tickets/${ticketId}/known-issues/${articleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-known-issues', tenantSlug, ticketId] });
      toast.success('알려진 이슈 연결이 해제되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 담당 반납
  const releaseMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/queue/${ticketId}/release`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-detail-full', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      toast.success('티켓이 풀로 반납되었습니다.');
    },
    onError: (err) => {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 403) {
        toast.error('본인 담당 티켓만 반납 가능합니다.');
        return;
      }
      toast.error(getErrorMessage(err));
    },
  });

  // 고객 포털 매직링크 발급 (락아웃 구제 — 이메일 외 채널 전달용)
  const portalLinkMutation = useMutation({
    mutationFn: () => issuePortalLink(tenantSlug, ticketId),
    onSuccess: async ({ url, expiresAt }) => {
      try {
        await navigator.clipboard.writeText(url);
        toast.success(`고객 포털 링크가 복사되었습니다 (${formatPortalExpiry(expiresAt)})`);
      } catch {
        toast.error('클립보드 복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
      }
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (ticketLoading) return <PageSkeleton />;

  if (ticketError) { /* AS-W1 */
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <AlertTriangle size={24} className="text-error-text" />
        <p className="text-sm text-text-secondary">티켓을 불러오지 못했습니다.</p>
        <button
          onClick={() => refetchTicket()}
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
        >
          <RefreshCw size={12} />
          다시 시도
        </button>
        <Link href={`/${tenantSlug}/tickets`} className="text-sm text-text-secondary hover:text-text-primary">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

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
          {/* BUG-ITSM-003: 상태/우선순위 Select 드롭다운 (슬라이더와 동일) */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-secondary">상태</span>
              <div className="w-32">
                <Select
                  value={ticket.status}
                  onValueChange={(v) => statusMutation.mutate(v as TicketStatus)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABELS) as TicketStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {ticket.escalation_level != null && ticket.escalation_level > 1 && (
              <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                {ticket.escalation_level}차 대응
              </span>
            )}
            <SlaBadge deadline={ticket.sla_response_deadline} label="응답" />
            <SlaBadge deadline={ticket.sla_resolution_deadline} label="해결" />
            {(ticket.status === 'resolved' || ticket.status === 'closed') && (
              <button
                type="button"
                onClick={() => setKbModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <BookOpen size={10} />
                KB로 저장
              </button>
            )}
          </div>
        </div>

        {/* BUG-ITSM-004: 타이머 스트립 */}
        <div className="mb-4">
          {myTimer ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-warning-bg border border-warning-border px-3 py-2">
              <Clock size={13} className="text-warning-text animate-pulse shrink-0" />
              <span className="font-mono text-sm font-semibold text-warning-text tabular-nums">
                {elapsed}
              </span>
              <span className="flex-1 text-xs text-warning-text">작업 진행 중</span>
              <Button
                size="sm"
                onClick={() => setShowStopModal(true)}
                className="btn-warning border-0 text-[#1A1A1A] h-6 text-xs px-2"
              >
                중지 및 기록
              </Button>
            </div>
          ) : otherTimers.length > 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface-elevated border border-border-default px-3 py-2 text-xs text-text-secondary">
              <Clock size={12} className="text-warning-text shrink-0" />
              <span className="flex-1">
                {otherTimers[0].ticket_title
                  ? `"${otherTimers[0].ticket_title}" 타이머 실행 중`
                  : '다른 티켓 타이머 실행 중'}
              </span>
              <button
                onClick={() => setShowOtherTimerModal(true)}
                className="text-brand hover:underline font-medium whitespace-nowrap"
              >
                중지 후 시작
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartTimer}
              disabled={startTimerMutation.isPending}
              className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-dashed border-border-default hover:border-border-strong text-xs text-text-secondary hover:text-text-primary px-3 py-2 transition-colors"
            >
              <Play size={11} />
              이 티켓 타이머 시작
            </button>
          )}
        </div>

        {/* 2컬럼 레이아웃 */}
        <div className="grid grid-cols-[1fr_20rem] gap-6 items-start">
          {/* ── 왼쪽: 본문 + 활동 타임라인 ── */}
          <div className="flex flex-col gap-6 min-w-0">
            {/* 설명 */}
            {ticket.description && (
              <div className="rounded-lg border border-border-default shadow-[var(--shadow-card)] bg-surface p-5">
                <h2 className="text-sm font-semibold text-text-secondary mb-3">설명</h2>
                <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                  {ticket.description}
                </p>
              </div>
            )}

            {/* 활동 타임라인 */}
            <div className="rounded-lg border border-border-default shadow-[var(--shadow-card)] bg-surface">
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
                    ) : item.kind === 'escalation' ? (
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
                    ) : (
                      <SystemEventRow key={`s-${item.data.id}`} event={item.data} />
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
                {/* RX-2d: 티켓 요청자 연락처 */}
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">요청자</span>
                  {ticket.requester_contact_name ? (
                    <span className="text-text-primary font-medium">{ticket.requester_contact_name}</span>
                  ) : (
                    <span className="text-text-disabled">미지정</span>
                  )}
                </div>
              </div>

              {/* 고객 포털 매직링크 발급 — 락아웃 구제(전화/메신저 전달용) */}
              {ticket.customer_id ? (
                <button
                  type="button"
                  onClick={() => portalLinkMutation.mutate()}
                  disabled={portalLinkMutation.isPending}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border-default hover:border-border-strong text-xs text-text-secondary hover:text-text-primary px-2 py-1.5 transition-colors mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Link2 size={11} />
                  {portalLinkMutation.isPending ? '발급 중...' : '고객 포털 링크 발급'}
                </button>
              ) : (
                <p className="text-xs text-text-disabled text-center mt-1">고객 연결 후 포털 링크 발급 가능</p>
              )}
            </SideSection>

            {/* SLA 현황 */}
            <SideSection title="SLA 현황">
              <SlaTimeDisplay deadline={ticket.sla_response_deadline} label="응답 마감" />
              <SlaTimeDisplay deadline={ticket.sla_resolution_deadline} label="해결 마감" />
            </SideSection>

            {/* 담당자 */}
            <SideSection title="담당자">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm">
                  {ticket.assignee_name ? (
                    <span className="text-text-primary">{ticket.assignee_name}</span>
                  ) : (
                    <span className="text-text-disabled">미배정</span>
                  )}
                </div>
                {ticket.assignee_name && (
                  <button
                    onClick={() => releaseMutation.mutate()}
                    disabled={releaseMutation.isPending}
                    className="shrink-0 flex items-center gap-1 text-xs text-text-secondary hover:text-error-text transition-colors px-1.5 py-0.5 rounded border border-border-default hover:border-error-text"
                  >
                    <UserMinus size={11} />
                    반납
                  </button>
                )}
              </div>
            </SideSection>

            {/* 알려진 이슈 */}
            <SideSection title="알려진 이슈">
              {linkedKisRaw.length === 0 ? (
                <p className="text-xs text-text-disabled text-center py-1">연결된 알려진 이슈 없음</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {linkedKisRaw.map((ki) => (
                    <div key={ki.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-text-primary font-medium leading-snug">{ki.title}</p>
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {ki.ki_severity && (
                            <span className="inline-flex items-center rounded-full bg-error-bg px-1.5 py-0.5 text-[10px] font-medium text-error-text">
                              {ki.ki_severity}
                            </span>
                          )}
                          {ki.ki_status && (
                            <span className="inline-flex items-center rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                              {ki.ki_status}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => unlinkKiMutation.mutate(ki.id)}
                        disabled={unlinkKiMutation.isPending}
                        className="shrink-0 text-text-disabled hover:text-error-text transition-colors mt-0.5"
                        title="연결 해제"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setKiLinkOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border-default hover:border-border-strong text-xs text-text-secondary hover:text-text-primary px-2 py-1.5 transition-colors mt-1"
              >
                <Link2 size={11} />
                + 연결
              </button>
            </SideSection>

            {/* 작업 시간 요약 */}
            <SideSection title="작업 시간">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">누적 시간</span>
                  <span className="text-text-primary font-semibold tabular-nums">
                    {totalHours > 0 ? `${totalHours.toFixed(1)}h` : '-'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">청구 가능</span>
                  <span className="text-text-primary tabular-nums">
                    {billableHours > 0 ? `${billableHours.toFixed(1)}h` : '-'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">작업 일지</span>
                  <span className="text-text-primary tabular-nums">{workLogs.length}건</span>
                </div>
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
    <CreateKbModal
      open={kbModalOpen}
      onClose={() => setKbModalOpen(false)}
      tenantSlug={tenantSlug}
      prefill={{
        title: ticket.title,
        content: ticket.description ?? '',
        linkedTicketId: ticket.id,
      }}
    />
    {/* BUG-ITSM-004: 타이머 중지 모달 */}
    <WorkLogStopModal
      open={showStopModal}
      onClose={() => setShowStopModal(false)}
      tenantSlug={tenantSlug}
      ticketId={ticketId}
      elapsed={elapsed}
      onStopped={() => {
        queryClient.invalidateQueries({ queryKey: ['work-timer', tenantSlug] });
        queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug, ticketId] });
      }}
    />
    {otherTimers[0] && (
      <WorkLogStopModal
        open={showOtherTimerModal}
        onClose={() => setShowOtherTimerModal(false)}
        tenantSlug={tenantSlug}
        ticketId={otherTimers[0].ticket_id}
        elapsed={otherElapsed}
        title={
          otherTimers[0].ticket_title
            ? `${otherTimers[0].ticket_number ?? ''} ${otherTimers[0].ticket_title} 작업 일지 기록`.trim()
            : '이전 작업 일지 기록'
        }
        onStopped={() => startTimerMutation.mutate()}
      />
    )}
    {/* 알려진 이슈 연결 모달 */}
    {kiLinkOpen && (
      <div
        className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40"
        onClick={(e) => { if (e.target === e.currentTarget) setKiLinkOpen(false); }}
      >
        <div className="bg-surface rounded-xl border border-border-default shadow-lg w-[420px] max-h-[500px] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
            <h3 className="text-sm font-semibold text-text-primary">알려진 이슈 연결</h3>
            <button
              onClick={() => setKiLinkOpen(false)}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 p-2">
            {allKisLoading ? (
              <div className="flex items-center justify-center py-10 text-text-secondary text-sm">
                로딩 중...
              </div>
            ) : allKisRaw.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-text-secondary text-sm">
                등록된 알려진 이슈가 없습니다.
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {allKisRaw.map((ki) => (
                  <li key={ki.id}>
                    <button
                      onClick={() => linkKiMutation.mutate(ki.id)}
                      disabled={linkKiMutation.isPending}
                      className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-surface-elevated transition-colors"
                    >
                      <p className="text-sm text-text-primary font-medium">{ki.title}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {ki.ki_severity && (
                          <span className="inline-flex items-center rounded-full bg-error-bg px-1.5 py-0.5 text-[10px] font-medium text-error-text">
                            {ki.ki_severity}
                          </span>
                        )}
                        {ki.ki_status && (
                          <span className="inline-flex items-center rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                            {ki.ki_status}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
