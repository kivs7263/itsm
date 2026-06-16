'use client';

import * as React from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { EscalationOut } from '@/lib/types';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// -----------------------------------------------------------------------
// 사유 레이블 맵
// -----------------------------------------------------------------------
const REASON_LABELS: Record<string, string> = {
  technical_complexity: '기술적 복잡도',
  permission_lack:      '권한 부족',
  sla_breach:           'SLA 위반',
  sla_warning:          'SLA 경고',
  customer_request:     '고객 요청',
  manual:               '직접 지정',
  other:                '기타',
};

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------
interface EscalationEventCardProps {
  esc: EscalationOut;
  ticketId: string;
  tenantSlug: string;
  onAcknowledged?: () => void;
}

// -----------------------------------------------------------------------
// EscalationEventCard
// -----------------------------------------------------------------------
export function EscalationEventCard({
  esc,
  ticketId,
  tenantSlug,
  onAcknowledged,
}: EscalationEventCardProps) {
  const queryClient = useQueryClient();

  const acknowledgeMutation = useMutation({
    mutationFn: () =>
      api.patch(
        `/${tenantSlug}/tickets/${ticketId}/escalations/${esc.id}/acknowledge`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['escalations', tenantSlug, ticketId],
      });
      toast.success('인지 처리되었습니다.');
      onAcknowledged?.();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const reasonLabel = REASON_LABELS[esc.reason] ?? esc.reason;

  return (
    <div className="flex gap-2.5">
      {/* 타임라인 아이콘 */}
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
        <ArrowRightLeft size={11} className="text-orange-600 dark:text-orange-400" />
      </div>

      <div className="flex-1 min-w-0 rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <span className="text-sm font-semibold text-text-primary leading-snug">
            {esc.from_level}차 → {esc.to_level}차 이관
            {esc.to_team_name ? ` · ${esc.to_team_name}` : ''}
          </span>
          <span className="text-xs text-text-secondary whitespace-nowrap shrink-0">
            {formatRelativeTime(esc.created_at)}
          </span>
        </div>

        {/* 사유 뱃지 */}
        <div className="mb-1.5">
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
          )}>
            {reasonLabel}
          </span>
        </div>

        {/* 인수인계 내용 미리보기 */}
        {esc.handover_memo && (
          <p className="text-xs text-text-primary line-clamp-2 mb-1.5">
            {esc.handover_memo}
          </p>
        )}

        {/* 담당자 정보 */}
        {esc.triggered_by_name && (
          <p className="text-xs text-text-disabled mb-1.5">
            이관자: {esc.triggered_by_name}
          </p>
        )}

        {/* 풋터: 인지 상태 */}
        <div className="flex items-center justify-between pt-1 border-t border-border-subtle mt-1">
          {esc.acknowledged_at ? (
            <span className="text-xs text-text-secondary">
              ✓ {formatRelativeTime(esc.acknowledged_at)} 인지
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => acknowledgeMutation.mutate()}
              isLoading={acknowledgeMutation.isPending}
              disabled={acknowledgeMutation.isPending}
              className="h-6 text-xs px-2"
            >
              인지
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
