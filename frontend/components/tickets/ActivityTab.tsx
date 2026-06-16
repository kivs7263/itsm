'use client';

import * as React from 'react';
import { Play, Clock, Plus, Trash2, Send } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { TicketComment } from '@/lib/types';
import { cn, formatRelativeTime, formatWorkHours } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkLogStopModal } from './WorkLogStopModal';
import { ReplyTemplatePicker } from './ReplyTemplatePicker';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface WorkLog {
  id: string;
  ticket_id: string;
  user_id: string | null;
  user_name: string | null;
  work_type: string;
  hours: number;
  billable: boolean;
  description: string | null;
  completion_status: string | null;
  next_action: string | null;
  memo: string | null;
  started_at: string | null;
  logged_at: string;
}

interface TimerActiveItem {
  ticket_id: string;
  ticket_number: string | null;
  ticket_title: string | null;
  started_at: string;
  elapsed_seconds: number;
}

type ActivityItem =
  | { kind: 'comment'; timestamp: string; data: TicketComment }
  | { kind: 'work_log'; timestamp: string; data: WorkLog };

const WORK_TYPE_LABELS: Record<string, string> = {
  remote:   '원격',
  onsite:   '현장',
  phone:    '전화',
  email:    '이메일',
  internal: '내부',
};

const COMPLETION_LABELS: Record<string, { label: string; cls: string }> = {
  completed:      { label: '완료',         cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  partial:        { label: '부분 완료',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  needs_followup: { label: '추가 대응 필요', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

// ──────────────────────────────────────────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

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

function WorkLogCard({
  log,
  onDelete,
}: {
  log: WorkLog;
  onDelete: () => void;
}) {
  const completion = log.completion_status ? COMPLETION_LABELS[log.completion_status] : null;
  return (
    <div className="flex gap-2.5">
      {/* 왼쪽 타임라인 아이콘 */}
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
        <Clock size={11} className="text-amber-600 dark:text-amber-400" />
      </div>

      <div className="flex-1 min-w-0 rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-text-primary tabular-nums">{formatWorkHours(log.hours)}</span>
            <span className={cn(
              'text-xs rounded-full px-1.5 py-0.5',
              log.billable
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-surface-hover text-text-secondary',
            )}>
              {log.billable ? '유상' : '무상'}
            </span>
            <span className="text-xs text-text-secondary bg-surface-hover rounded px-1.5 py-0.5">
              {WORK_TYPE_LABELS[log.work_type] ?? log.work_type}
            </span>
            {completion && (
              <span className={cn('text-xs rounded-full px-1.5 py-0.5', completion.cls)}>
                {completion.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-text-secondary whitespace-nowrap">
              {formatRelativeTime(log.logged_at)}
            </span>
            <button
              onClick={onDelete}
              className="text-text-disabled hover:text-red-500 transition-colors"
              aria-label="삭제"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {log.description && (
          <p className="text-xs text-text-primary line-clamp-3">{log.description}</p>
        )}
        {log.next_action && (
          <p className="text-xs text-text-secondary mt-0.5">→ {log.next_action}</p>
        )}
        <p className="text-xs text-text-disabled mt-1">{log.user_name ?? '알 수 없음'}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ActivityTab
// ──────────────────────────────────────────────────────────────────────────────

interface ActivityTabProps {
  ticketId: string;
  tenantSlug: string;
}

export function ActivityTab({ ticketId, tenantSlug }: ActivityTabProps) {
  const queryClient = useQueryClient();

  // Comment input
  const [commentBody, setCommentBody] = React.useState('');
  const [isInternal, setIsInternal] = React.useState(false);

  // Manual work log form
  const [showAddLog, setShowAddLog] = React.useState(false);
  const [logHours, setLogHours] = React.useState('');
  const [logType, setLogType] = React.useState('remote');
  const [logBillable, setLogBillable] = React.useState(true);
  const [logMemo, setLogMemo] = React.useState('');

  // Timer modals
  const [showStopModal, setShowStopModal] = React.useState(false);
  const [showOtherTimerModal, setShowOtherTimerModal] = React.useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: comments, isLoading: commentsLoading } = useQuery<TicketComment[]>({
    queryKey: ['ticket-comments', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/comments`).then((r) => {
        const d = r.data;
        if (Array.isArray(d)) return d;
        if (Array.isArray(d?.items)) return d.items;
        return [];
      }),
    enabled: !!ticketId,
    refetchInterval: 30000,
  });

  const { data: workLogs, isLoading: logsLoading } = useQuery<WorkLog[]>({
    queryKey: ['work-logs', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/work-logs`).then((r) => r.data),
    enabled: !!ticketId,
    refetchInterval: 30000,
  });

  const { data: timers = [] } = useQuery<TimerActiveItem[]>({
    queryKey: ['work-timer', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/work-logs/timer/active`).then((r) => r.data),
    refetchInterval: 10000,
  });

  const myTimer = timers.find((t) => t.ticket_id === ticketId);
  const otherTimers = timers.filter((t) => t.ticket_id !== ticketId);
  const isThisTicketTimer = !!myTimer;
  const elapsed = useElapsed(myTimer?.started_at ?? null, !!myTimer);
  const otherElapsed = useElapsed(
    otherTimers[0]?.started_at ?? null,
    otherTimers.length > 0,
  );

  // ── Merged timeline ────────────────────────────────────────────────────────

  const activityItems: ActivityItem[] = React.useMemo(() => {
    const items: ActivityItem[] = [
      ...(comments ?? []).map((c) => ({
        kind: 'comment' as const,
        timestamp: c.created_at,
        data: c,
      })),
      ...(workLogs ?? []).map((l) => ({
        kind: 'work_log' as const,
        timestamp: l.logged_at,
        data: l,
      })),
    ];
    return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [comments, workLogs]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const commentMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/tickets/${ticketId}/comments`, {
        body: commentBody,
        is_internal: isInternal,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-comments', tenantSlug, ticketId] });
      setCommentBody('');
      setIsInternal(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const startMutation = useMutation({
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
    startMutation.mutate();
  }

  const createLogMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/tickets/${ticketId}/work-logs`, {
        work_type: logType,
        hours: parseFloat(logHours),
        billable: logBillable,
        memo: logMemo || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      setShowAddLog(false);
      setLogHours('');
      setLogMemo('');
      toast.success('공수가 기록되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteLogMutation = useMutation({
    mutationFn: (logId: string) =>
      api.delete(`/${tenantSlug}/tickets/${ticketId}/work-logs/${logId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      toast.success('삭제되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isLoading = commentsLoading || logsLoading;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* 현재 티켓 타이머 중지 모달 */}
      <WorkLogStopModal
        open={showStopModal}
        onClose={() => setShowStopModal(false)}
        tenantSlug={tenantSlug}
        ticketId={ticketId}
        elapsed={elapsed}
        onStopped={() => {
          queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug, ticketId] });
          queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
        }}
      />
      {/* 다른 티켓 타이머 먼저 중지 → 이 티켓 시작 */}
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
          onStopped={() => startMutation.mutate()}
        />
      )}

      <div className="flex flex-col h-full">
        {/* 타이머 스트립 */}
        <div className="shrink-0 px-4 pt-3 pb-2">
          {isThisTicketTimer ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40 px-3 py-2">
              <Clock size={13} className="text-amber-600 dark:text-amber-400 animate-pulse shrink-0" />
              <span className="font-mono text-sm font-semibold text-amber-800 dark:text-amber-300 tabular-nums">
                {elapsed}
              </span>
              <span className="flex-1 text-xs text-amber-700 dark:text-amber-400">작업 진행 중</span>
              <Button
                size="sm"
                onClick={() => setShowStopModal(true)}
                className="bg-amber-500 hover:bg-amber-600 text-[#1A1A1A] border-0 h-6 text-xs px-2"
              >
                중지 및 기록
              </Button>
            </div>
          ) : otherTimers.length > 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface-elevated border border-border-default px-3 py-2 text-xs text-text-secondary">
              <Clock size={12} className="text-amber-500 shrink-0" />
              <span className="flex-1">
                {otherTimers[0].ticket_title
                  ? `"${otherTimers[0].ticket_title}" 타이머 실행 중`
                  : '다른 티켓 타이머 실행 중'}
                {otherTimers.length > 1 && ` (외 ${otherTimers.length - 1}개)`}
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
              disabled={startMutation.isPending}
              className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-dashed border-border-default hover:border-border-strong text-xs text-text-secondary hover:text-text-primary px-3 py-2 transition-colors"
            >
              <Play size={11} />
              이 티켓 타이머 시작
            </button>
          )}
        </div>

        {/* 타임라인 피드 */}
        <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-2.5">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : activityItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-text-secondary py-12">
              <p className="text-sm">아직 활동 내역이 없습니다.</p>
              <p className="text-xs">댓글을 보내거나 타이머를 시작해보세요.</p>
            </div>
          ) : (
            activityItems.map((item) =>
              item.kind === 'comment' ? (
                <CommentBubble key={`c-${item.data.id}`} comment={item.data} />
              ) : (
                <WorkLogCard
                  key={`w-${item.data.id}`}
                  log={item.data}
                  onDelete={() => deleteLogMutation.mutate(item.data.id)}
                />
              ),
            )
          )}
        </div>

        {/* 수동 공수 추가 폼 (접기 가능) */}
        {showAddLog && (
          <div className="shrink-0 mx-4 mb-2 rounded-lg border border-border-default bg-surface-elevated p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-text-secondary">공수 직접 입력</span>
              <button
                onClick={() => setShowAddLog(false)}
                className="text-xs text-text-secondary hover:text-text-primary"
              >
                닫기
              </button>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={logHours}
                  onChange={(e) => setLogHours(e.target.value)}
                  placeholder="시간 (예: 1.5)"
                  className="w-full h-8 rounded border border-border-default bg-surface px-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>
              <div className="w-24">
                <select
                  value={logType}
                  onChange={(e) => setLogType(e.target.value)}
                  className="w-full h-8 text-sm rounded border border-border-default bg-surface px-2 text-text-primary"
                >
                  {Object.entries(WORK_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <input
              type="text"
              value={logMemo}
              onChange={(e) => setLogMemo(e.target.value)}
              placeholder="메모 (선택)"
              className="h-8 rounded border border-border-default bg-surface px-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={logBillable}
                  onChange={(e) => setLogBillable(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand"
                />
                <span className="text-xs text-text-secondary">유상</span>
              </label>
              <Button
                size="sm"
                onClick={() => createLogMutation.mutate()}
                isLoading={createLogMutation.isPending}
                disabled={!logHours || isNaN(parseFloat(logHours)) || parseFloat(logHours) <= 0}
              >
                저장
              </Button>
            </div>
          </div>
        )}

        {/* 댓글 입력창 */}
        <div className="shrink-0 border-t border-border-default p-4">
          <div className="flex flex-col gap-2">
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border-strong accent-brand cursor-pointer"
                  />
                  <span className="text-xs text-text-secondary">내부 메모</span>
                </label>
                <button
                  onClick={() => setShowAddLog((v) => !v)}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Plus size={12} />
                  공수 추가
                </button>
              </div>
              <div className="flex items-center gap-2">
                <ReplyTemplatePicker
                  tenantSlug={tenantSlug}
                  onSelect={(body) =>
                    setCommentBody((prev) => (prev ? prev + '\n\n' + body : body))
                  }
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (commentBody.trim()) commentMutation.mutate();
                  }}
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
      </div>
    </>
  );
}
