'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { RecurringAlert, RecurringAlertsResponse } from '@/lib/types';

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-5 w-10 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
          <td className="px-4 py-3"><Skeleton className="h-7 w-20 rounded-md" /></td>
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 빈 상태
// -----------------------------------------------------------------------
function EmptyState() {
  return (
    <tr>
      <td colSpan={4}>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(34, 197, 94, 0.12)' }}
          >
            <CheckCircle2 size={24} strokeWidth={1.5} style={{ color: '#22c55e' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-primary">반복 감지된 장애 없음</p>
            <p className="text-xs text-text-secondary mt-0.5">
              현재 반복 패턴이 감지된 장애가 없습니다.
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 반복 장애 알림 페이지
// -----------------------------------------------------------------------
export default function RecurringAlertsPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<RecurringAlertsResponse>({
    queryKey: ['recurring-alerts', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/recurring-alerts`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) =>
      api.post(`/${tenantSlug}/recurring-alerts/${alertId}/acknowledge`).then((r) => r.data),
    onSuccess: () => {
      toast.success('알림을 인지 처리했습니다.');
      queryClient.invalidateQueries({ queryKey: ['recurring-alerts', tenantSlug] });
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  const alerts: RecurringAlert[] = data?.items ?? [];
  const total = data?.total ?? 0;

  // 미인지 건수
  const unacknowledgedCount = alerts.filter((a) => !a.is_acknowledged).length;

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-text-primary">반복 장애 알림</h1>
          {unacknowledgedCount > 0 && (
            <span className="flex items-center justify-center h-5 min-w-5 rounded-full bg-warning text-white text-[10px] font-bold px-1.5">
              {unacknowledgedCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ['recurring-alerts', tenantSlug] })
          }
        >
          새로고침
        </Button>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0 mt-4">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                발생 횟수
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                트리거 티켓 수
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">
                감지 시각
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary">
                액션
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : alerts.length === 0 ? (
              <EmptyState />
            ) : (
              alerts.map((alert) => (
                <tr
                  key={alert.id}
                  className={cn(
                    'border-b border-border-subtle transition-colors',
                    alert.is_acknowledged
                      ? 'opacity-50'
                      : 'hover:bg-surface-hover',
                  )}
                >
                  {/* 발생 횟수 */}
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        alert.occurrence_count >= 5
                          ? 'bg-error-bg text-error-text'
                          : alert.occurrence_count >= 3
                            ? 'bg-warning-bg text-warning-text'
                            : 'bg-info-bg text-info-text',
                      )}
                    >
                      <RefreshCw size={10} />
                      {alert.occurrence_count}회
                    </span>
                  </td>

                  {/* 트리거 티켓 수 */}
                  <td className="px-4 py-3 text-text-secondary text-xs tabular-nums">
                    {alert.trigger_ticket_ids.length}건
                  </td>

                  {/* 감지 시각 */}
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {formatRelativeTime(alert.detected_at)}
                  </td>

                  {/* 액션 */}
                  <td className="px-4 py-3 text-right">
                    {alert.is_acknowledged ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success-text">
                        <CheckCircle2 size={12} />
                        인지됨
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<BellOff size={13} />}
                        onClick={() => acknowledgeMutation.mutate(alert.id)}
                        isLoading={
                          acknowledgeMutation.isPending &&
                          acknowledgeMutation.variables === alert.id
                        }
                        disabled={acknowledgeMutation.isPending}
                      >
                        인지
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
