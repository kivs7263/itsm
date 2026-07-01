'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { TicketStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// -----------------------------------------------------------------------
// 대량 상태 변경 바
// selectedIds.length > 0 일 때 하단 fixed로 노출
// -----------------------------------------------------------------------

interface BulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
  tenantSlug: string;
}

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: 'open',        label: '열림' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'pending',     label: '대기' },
  { value: 'resolved',    label: '해결됨' },
  { value: 'closed',      label: '닫힘' },
];

export function BulkActionBar({ selectedIds, onClear, tenantSlug }: BulkActionBarProps) {
  const queryClient = useQueryClient();
  const [targetStatus, setTargetStatus] = React.useState<TicketStatus | ''>('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const isVisible = selectedIds.length > 0;

  async function handleApply() {
    if (!targetStatus) {
      toast.error('변경할 상태를 선택해주세요.');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post(`/${tenantSlug}/tickets/bulk-status`, {
        ticket_ids: selectedIds,
        status: targetStatus,
      });
      toast.success(`${selectedIds.length}개 티켓의 상태가 변경되었습니다.`);
      await queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      onClear();
      setTargetStatus('');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="대량 작업"
      className={[
        'fixed bottom-0 left-0 right-0 z-50',
        'flex items-center justify-between gap-4',
        'px-6 py-3 bg-surface border-t border-border-default shadow-lg',
        'transition-transform duration-base',
        isVisible ? 'translate-y-0' : 'translate-y-full',
      ].join(' ')}
    >
      {/* 선택 정보 */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-text-primary">
          {selectedIds.length}개 선택됨
        </span>
        <button
          onClick={onClear}
          className="text-text-secondary hover:text-text-primary transition-colors"
          aria-label="선택 해제"
        >
          <X size={16} />
        </button>
      </div>

      {/* 상태 변경 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-secondary whitespace-nowrap">상태 변경:</span>
        <div className="w-36">
          <Select
            value={targetStatus}
            onValueChange={(v) => setTargetStatus(v as TicketStatus)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="상태 선택" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          onClick={handleApply}
          isLoading={isSubmitting}
          disabled={!targetStatus}
        >
          적용
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { onClear(); setTargetStatus(''); }}
        >
          취소
        </Button>
      </div>
    </div>
  );
}
