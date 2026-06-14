'use client';

import * as React from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------

interface InstallationHistoryEntry {
  step: string;
  completed_at: string;
  actor_id: string;
  note: string | null;
}

interface InstallationData {
  installation_step: string | null;
  installation_history: InstallationHistoryEntry[];
  ticket_status: string;
}

// -----------------------------------------------------------------------
// 상수
// -----------------------------------------------------------------------

type InstallationStep = 'survey' | 'executing' | 'verification' | 'acceptance';

const STEPS: InstallationStep[] = ['survey', 'executing', 'verification', 'acceptance'];

const STEP_LABELS: Record<InstallationStep, string> = {
  survey:      '현장 조사',
  executing:   '설치 진행',
  verification: '검수',
  acceptance:  '인수 확인',
};

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

interface InstallationStepPanelProps {
  ticketId: string;
  tenantSlug: string;
}

// -----------------------------------------------------------------------
// 단계 상태 판별
// -----------------------------------------------------------------------

type StepState = 'done' | 'current' | 'future' | 'all-done';

function getStepState(
  step: InstallationStep,
  currentStep: string | null,
  allDone: boolean,
): StepState {
  if (allDone) return 'all-done';
  if (currentStep === null) return 'future';
  const currentIdx = STEPS.indexOf(currentStep as InstallationStep);
  const stepIdx = STEPS.indexOf(step);
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'current';
  return 'future';
}

// -----------------------------------------------------------------------
// 스텝 아이콘
// -----------------------------------------------------------------------

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done' || state === 'all-done') {
    return <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />;
  }
  if (state === 'current') {
    return <Circle className="h-6 w-6 text-blue-500 shrink-0 fill-blue-100" />;
  }
  return <Circle className="h-6 w-6 text-gray-300 shrink-0" />;
}

// -----------------------------------------------------------------------
// InstallationStepPanel
// -----------------------------------------------------------------------

export function InstallationStepPanel({ ticketId, tenantSlug }: InstallationStepPanelProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = React.useState('');

  const { data, isLoading } = useQuery<InstallationData>({
    queryKey: ['ticket-installation', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/installation`).then((r) => r.data),
    enabled: !!ticketId,
  });

  const advanceMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/tickets/${ticketId}/installation/advance`, {
        note: note.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-installation', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['ticket', tenantSlug, ticketId] });
      setNote('');
      toast.success('다음 단계로 진행되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-5">
        {STEPS.map((s) => (
          <Skeleton key={s} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const currentStep = data.installation_step;
  // acceptance 단계가 완료되면 (history에 acceptance 엔트리가 있으면) 전체 완료
  const isAllDone = data.installation_history.some((h) => h.step === 'acceptance');

  // 이력에서 단계별 완료 정보 빠르게 조회
  const historyMap = new Map<string, InstallationHistoryEntry>();
  for (const entry of data.installation_history) {
    historyMap.set(entry.step, entry);
  }

  return (
    <div className="p-5 flex flex-col gap-0">
      {/* 완료 배너 */}
      {isAllDone && (
        <div className="mb-6 rounded-lg bg-green-50 border border-green-200 dark:bg-green-950/30 dark:border-green-800/30 px-4 py-3 text-sm text-green-700 dark:text-green-400 font-medium">
          설치 완료 — 티켓이 해결됨으로 처리되었습니다
        </div>
      )}

      {/* Stepper */}
      <ol className="flex flex-col gap-0">
        {STEPS.map((step, idx) => {
          const state = getStepState(step, currentStep, isAllDone);
          const histEntry = historyMap.get(step);
          const isLast = idx === STEPS.length - 1;
          const isCurrent = state === 'current';

          return (
            <li key={step} className="flex gap-3">
              {/* 왼쪽: 아이콘 + 연결선 */}
              <div className="flex flex-col items-center">
                <StepIcon state={state} />
                {!isLast && (
                  <div
                    className={cn(
                      'w-0.5 flex-1 min-h-[24px]',
                      state === 'done' || state === 'all-done'
                        ? 'bg-green-400'
                        : 'bg-gray-200 dark:bg-gray-700',
                    )}
                  />
                )}
              </div>

              {/* 오른쪽: 콘텐츠 */}
              <div className={cn('flex-1 pb-5', isLast && 'pb-0')}>
                <div className="flex items-center gap-2 min-h-[24px]">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      state === 'done' || state === 'all-done'
                        ? 'text-green-600 dark:text-green-400'
                        : state === 'current'
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-text-secondary',
                    )}
                  >
                    {STEP_LABELS[step]}
                  </span>
                  {isCurrent && !isAllDone && (
                    <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                      현재 단계
                    </span>
                  )}
                </div>

                {/* 완료 이력 표시 */}
                {histEntry && (
                  <p className="mt-1 text-xs text-text-secondary">
                    {new Date(histEntry.completed_at).toLocaleString('ko-KR')}
                    {' · '}
                    처리자: {histEntry.actor_id.slice(0, 8)}
                    {histEntry.note && (
                      <span className="ml-1 italic">— {histEntry.note}</span>
                    )}
                  </p>
                )}

                {/* 현재 단계: 메모 입력 + 다음 단계 버튼 */}
                {isCurrent && !isAllDone && (
                  <div className="mt-3 flex flex-col gap-2">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="메모 입력 (선택사항)"
                      rows={2}
                      className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
                    />
                    <Button
                      size="sm"
                      onClick={() => advanceMutation.mutate()}
                      isLoading={advanceMutation.isPending}
                    >
                      {step === 'verification'
                        ? '인수 확인으로 진행'
                        : step === 'acceptance'
                          ? '설치 완료 처리'
                          : '다음 단계로'}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
