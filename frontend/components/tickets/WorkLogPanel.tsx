'use client';

import * as React from 'react';
import { Play, Square, Trash2, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ──────────────────────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────────────────────

interface WorkLog {
  id: string;
  ticket_id: string;
  user_id: string | null;
  user_name: string | null;
  work_type: string;
  hours: number;
  billable: boolean;
  memo: string | null;
  started_at: string | null;
  logged_at: string;
}

interface TimerActive {
  active: boolean;
  ticket_id: string | null;
  started_at: string | null;
  elapsed_seconds: number | null;
}

interface WorkLogSummary {
  total_hours: number;
  billable_hours: number;
  unbillable_hours: number;
  billable_ratio: number;
  log_count: number;
}

const WORK_TYPE_LABELS: Record<string, string> = {
  remote:   '원격',
  onsite:   '현장',
  phone:    '전화',
  email:    '이메일',
  internal: '내부',
};

// ──────────────────────────────────────────────────────────────────────────────
// 타이머 표시
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
// WorkLogPanel
// ──────────────────────────────────────────────────────────────────────────────

interface WorkLogPanelProps {
  ticketId: string;
  tenantSlug: string;
}

export function WorkLogPanel({ ticketId, tenantSlug }: WorkLogPanelProps) {
  const queryClient = useQueryClient();

  // 수동 입력 폼 상태
  const [showForm, setShowForm] = React.useState(false);
  const [formHours, setFormHours] = React.useState('');
  const [formType, setFormType] = React.useState('remote');
  const [formBillable, setFormBillable] = React.useState(true);
  const [formMemo, setFormMemo] = React.useState('');

  // 공수 목록
  const { data: logs, isLoading } = useQuery<WorkLog[]>({
    queryKey: ['work-logs', tenantSlug, ticketId],
    queryFn: () => api.get(`/${tenantSlug}/tickets/${ticketId}/work-logs`).then((r) => r.data),
    enabled: !!ticketId,
    refetchInterval: 30000,
  });

  // 타이머 상태
  const { data: timer, isLoading: timerLoading } = useQuery<TimerActive>({
    queryKey: ['work-timer', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/work-logs/timer/active`).then((r) => r.data),
    refetchInterval: 10000,
  });

  const elapsed = useElapsed(timer?.started_at ?? null, timer?.active ?? false);

  // 집계
  const totalH = React.useMemo(() => {
    if (!logs?.length) return null;
    const total = logs.reduce((s, l) => s + l.hours, 0);
    const billable = logs.filter((l) => l.billable).reduce((s, l) => s + l.hours, 0);
    return { total: Math.round(total * 100) / 100, billable: Math.round(billable * 100) / 100 };
  }, [logs]);

  // 타이머 시작
  const startMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/work-logs/timer/start?ticket_id=${ticketId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-timer', tenantSlug] });
      toast.success('타이머가 시작되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 타이머 중지 → 자동 로그 생성
  const stopMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/work-logs/timer/stop`, {
        work_type: formType,
        hours: 0,
        billable: formBillable,
        memo: formMemo || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-timer', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug, ticketId] });
      setFormMemo('');
      toast.success('타이머가 중지되고 공수가 기록되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 수동 입력 저장
  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/tickets/${ticketId}/work-logs`, {
        work_type: formType,
        hours: parseFloat(formHours),
        billable: formBillable,
        memo: formMemo || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug, ticketId] });
      setShowForm(false);
      setFormHours('');
      setFormMemo('');
      toast.success('공수가 기록되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 삭제
  const deleteMutation = useMutation({
    mutationFn: (logId: string) =>
      api.delete(`/${tenantSlug}/tickets/${ticketId}/work-logs/${logId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug, ticketId] });
      toast.success('삭제되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isThisTicketTimer = timer?.active && timer.ticket_id === ticketId;

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* 집계 스트립 */}
      {totalH && (
        <div className="flex gap-4 rounded-lg bg-surface-elevated border border-border-subtle p-3 text-sm">
          <div className="flex flex-col items-center">
            <span className="text-xs text-text-secondary">총 공수</span>
            <span className="font-semibold text-text-primary">{totalH.total}h</span>
          </div>
          <div className="w-px bg-border-subtle" />
          <div className="flex flex-col items-center">
            <span className="text-xs text-text-secondary">유상</span>
            <span className="font-semibold text-green-600">{totalH.billable}h</span>
          </div>
          <div className="w-px bg-border-subtle" />
          <div className="flex flex-col items-center">
            <span className="text-xs text-text-secondary">무상</span>
            <span className="font-semibold text-text-secondary">
              {Math.round((totalH.total - totalH.billable) * 100) / 100}h
            </span>
          </div>
        </div>
      )}

      {/* 타이머 섹션 */}
      <div className="rounded-lg border border-border-default p-4">
        <p className="text-xs font-medium text-text-secondary mb-3">타이머</p>

        {timerLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : isThisTicketTimer ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 text-center">
              <span className="font-mono text-2xl font-semibold text-text-primary tabular-nums">
                {elapsed}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 w-28">
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="h-7 text-xs rounded border border-border-default bg-surface px-2 text-text-primary"
              >
                {Object.entries(WORK_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formBillable}
                  onChange={(e) => setFormBillable(e.target.checked)}
                  className="h-3 w-3 accent-brand"
                />
                <span className="text-xs text-text-secondary">유상</span>
              </label>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => stopMutation.mutate()}
              isLoading={stopMutation.isPending}
              leftIcon={<Square size={12} />}
            >
              중지
            </Button>
          </div>
        ) : timer?.active && !isThisTicketTimer ? (
          <p className="text-xs text-amber-600">
            다른 티켓에서 타이머가 실행 중입니다. 먼저 중지 후 시작하세요.
          </p>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => startMutation.mutate()}
            isLoading={startMutation.isPending}
            leftIcon={<Play size={12} />}
          >
            타이머 시작
          </Button>
        )}
      </div>

      {/* 공수 목록 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-text-secondary">기록</p>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 text-xs text-brand hover:underline"
          >
            <Plus size={12} />
            수동 입력
          </button>
        </div>

        {/* 수동 입력 폼 */}
        {showForm && (
          <div className="mb-3 rounded-lg border border-border-default bg-surface-elevated p-3 flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">시간 (h)</label>
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={formHours}
                  onChange={(e) => setFormHours(e.target.value)}
                  placeholder="예: 1.5"
                  className="w-full mt-0.5 h-8 rounded border border-border-default bg-surface px-2 text-sm text-text-primary"
                />
              </div>
              <div className="w-28">
                <label className="text-xs text-text-secondary">유형</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full mt-0.5 h-8 text-sm rounded border border-border-default bg-surface px-2 text-text-primary"
                >
                  {Object.entries(WORK_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <input
              type="text"
              value={formMemo}
              onChange={(e) => setFormMemo(e.target.value)}
              placeholder="메모 (선택)"
              className="h-8 rounded border border-border-default bg-surface px-2 text-sm text-text-primary placeholder:text-text-disabled"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formBillable}
                  onChange={(e) => setFormBillable(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand"
                />
                <span className="text-xs text-text-secondary">유상</span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="text-xs text-text-secondary hover:text-text-primary"
                >
                  취소
                </button>
                <Button
                  size="sm"
                  onClick={() => createMutation.mutate()}
                  isLoading={createMutation.isPending}
                  disabled={!formHours || isNaN(parseFloat(formHours)) || parseFloat(formHours) <= 0}
                >
                  저장
                </Button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : logs && logs.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface-elevated p-2.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-primary">
                      {log.hours}h
                    </span>
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
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {log.user_name ?? '알 수 없음'} ·{' '}
                    {new Date(log.logged_at).toLocaleDateString('ko-KR')}
                  </p>
                  {log.memo && (
                    <p className="text-xs text-text-secondary mt-0.5 truncate">{log.memo}</p>
                  )}
                </div>
                <button
                  onClick={() => deleteMutation.mutate(log.id)}
                  className="shrink-0 text-text-disabled hover:text-red-500 transition-colors mt-0.5"
                  aria-label="삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-secondary text-center py-6">
            아직 공수 기록이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
