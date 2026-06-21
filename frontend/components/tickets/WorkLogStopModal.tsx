'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

type CompletionStatus = 'completed' | 'partial' | 'needs_followup';

const COMPLETION_OPTIONS: { value: CompletionStatus; label: string; color: string }[] = [
  { value: 'completed',      label: '완료',         color: 'bg-success-bg text-success-text border-success-border' },
  { value: 'partial',        label: '부분 완료',    color: 'bg-warning-bg text-warning-text border-warning-border' },
  { value: 'needs_followup', label: '추가 대응 필요', color: 'bg-error-bg text-error-text border-error-border' },
];

const WORK_TYPE_LABELS: Record<string, string> = {
  remote:   '원격',
  onsite:   '현장',
  phone:    '전화',
  email:    '이메일',
  internal: '내부',
};

interface WorkLogStopModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  ticketId: string;
  elapsed: string;
  title?: string;
  onStopped?: () => void;
}

export function WorkLogStopModal({
  open,
  onClose,
  tenantSlug,
  ticketId,
  elapsed,
  title,
  onStopped,
}: WorkLogStopModalProps) {
  const queryClient = useQueryClient();

  const [description, setDescription] = React.useState('');
  const [completionStatus, setCompletionStatus] = React.useState<CompletionStatus>('completed');
  const [nextAction, setNextAction] = React.useState('');
  const [workType, setWorkType] = React.useState('remote');
  const [billable, setBillable] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setDescription('');
      setCompletionStatus('completed');
      setNextAction('');
    }
  }, [open]);

  const stopMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/work-logs/timer/stop`, {
        ticket_id: ticketId,
        work_type: workType,
        hours: 0,
        billable,
        description,
        completion_status: completionStatus,
        next_action: nextAction || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-timer', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['work-logs', tenantSlug] });
      toast.success('작업 일지가 기록되었습니다.');
      onStopped?.();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canSubmit = description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? '작업 일지 기록'}</DialogTitle>
          <p className="text-sm text-text-secondary mt-0.5">
            경과 시간 <span className="font-mono font-semibold text-text-primary">{elapsed}</span>
          </p>
        </DialogHeader>

        <div className="px-6 flex flex-col gap-4">
          {/* 수행한 내용 */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">
              수행한 내용 <span className="text-error-text">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="예: DB 연결 오류 원인 확인 — 방화벽 포트 3306 차단, 개방 후 정상 작동 확인"
              rows={3}
              className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </div>

          {/* 완료 여부 */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">완료 여부</label>
            <div className="flex gap-2">
              {COMPLETION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCompletionStatus(opt.value)}
                  className={cn(
                    'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-all',
                    completionStatus === opt.value
                      ? opt.color
                      : 'border-border-default text-text-secondary hover:bg-surface-hover',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 다음 액션 (완료가 아닐 때 강조) */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">
              다음 액션
              {completionStatus !== 'completed' && (
                <span className="ml-1 text-warning-text">권장</span>
              )}
            </label>
            <input
              type="text"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="예: 고객사 재확인 후 모니터링 2일"
              className="w-full h-8 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </div>

          {/* 작업 유형 + 유상 여부 */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">작업 유형</label>
              <select
                value={workType}
                onChange={(e) => setWorkType(e.target.value)}
                className="w-full h-8 text-sm rounded-md border border-border-default bg-surface px-2 text-text-primary"
              >
                {Object.entries(WORK_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer pb-1">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand"
              />
              <span className="text-sm text-text-secondary">유상</span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="text-sm text-text-secondary hover:text-text-primary px-3 py-1.5"
          >
            취소
          </button>
          <Button
            onClick={() => stopMutation.mutate()}
            isLoading={stopMutation.isPending}
            disabled={!canSubmit}
          >
            기록하고 중지
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
