'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Ticket, TicketStatus, TicketPriority } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SlaBadge } from './SlaBadge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ActivityTab } from './ActivityTab';
import { InstallationStepPanel } from './InstallationStepPanel';

// -----------------------------------------------------------------------
// 상태/우선순위 배지 색상
// -----------------------------------------------------------------------
const STATUS_LABELS: Record<TicketStatus, string> = {
  open:        '열림',
  in_progress: '진행 중',
  pending:     '대기',
  resolved:    '해결됨',
  closed:      '닫힘',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low:      '낮음',
  medium:   '보통',
  high:     '높음',
  critical: '긴급',
};

type SliderTab = 'activity' | 'details' | 'installation';

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------
interface TicketSliderProps {
  ticketId: string | null;
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

// -----------------------------------------------------------------------
// 스켈레톤 로딩
// -----------------------------------------------------------------------
function SliderSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-6 w-3/4" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 상세정보 탭
// -----------------------------------------------------------------------
function DetailsTab({ ticket }: { ticket: Ticket }) {
  const CHANNEL_LABELS: Record<string, string> = {
    email:    '이메일',
    phone:    '전화',
    portal:   '포털',
    internal: '내부',
  };

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: '고객',      value: ticket.customer_name ?? '-' },
    { label: '담당자',    value: ticket.assignee_name ?? '-' },
    { label: '채널',      value: CHANNEL_LABELS[ticket.channel] ?? ticket.channel },
    { label: '계약',      value: ticket.contract_id ?? '-' },
    { label: '생성일',    value: new Date(ticket.created_at).toLocaleString('ko-KR') },
    { label: '최종 수정', value: new Date(ticket.updated_at).toLocaleString('ko-KR') },
    ...(ticket.resolved_at ? [{ label: '해결일', value: new Date(ticket.resolved_at).toLocaleString('ko-KR') }] : []),
    ...(ticket.closed_at   ? [{ label: '종료일', value: new Date(ticket.closed_at).toLocaleString('ko-KR') }]   : []),
  ];

  return (
    <div className="divide-y divide-border-subtle">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-4 py-3">
          <span className="w-20 shrink-0 text-xs font-medium text-text-secondary">{row.label}</span>
          <span className="text-sm text-text-primary">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// TicketSlider
// -----------------------------------------------------------------------
export function TicketSlider({ ticketId, open, onClose, tenantSlug }: TicketSliderProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<SliderTab>('activity');

  // Escape 키로 닫기
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // 탭 리셋 (다른 티켓 열 때)
  React.useEffect(() => {
    if (ticketId) setActiveTab('activity');
  }, [ticketId]);

  // 티켓 상세 조회
  const { data: ticket, isLoading: ticketLoading } = useQuery<Ticket>({
    queryKey: ['ticket', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}`).then((r) => r.data),
    enabled: !!ticketId && open,
  });

  // 상태 변경 mutation
  const statusMutation = useMutation({
    mutationFn: (status: TicketStatus) =>
      api.patch(`/${tenantSlug}/tickets/${ticketId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      toast.success('상태가 변경되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 우선순위 변경 mutation
  const priorityMutation = useMutation({
    mutationFn: (priority: TicketPriority) =>
      api.patch(`/${tenantSlug}/tickets/${ticketId}`, { priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      toast.success('우선순위가 변경되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <>
      {/* 오버레이 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-surface-overlay"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* 슬라이드 패널 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="티켓 상세"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50',
          'w-full max-w-[640px]',
          'bg-surface border-l border-border-default shadow-xl',
          'flex flex-col overflow-hidden',
          'transition-transform duration-base ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border-default shrink-0">
          <div className="flex-1 min-w-0">
            {ticketLoading ? (
              <Skeleton className="h-5 w-2/3" />
            ) : (
              <h2 className="text-md font-semibold text-text-primary leading-snug">
                {ticket?.title ?? ''}
              </h2>
            )}
            {ticket && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <SlaBadge deadline={ticket.sla_response_deadline} label="응답" />
                <SlaBadge deadline={ticket.sla_resolution_deadline} label="해결" />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 상태/우선순위 컨트롤 */}
        {ticket && (
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border-default bg-surface-elevated shrink-0">
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
            <div className="h-4 w-px bg-border-default" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-secondary">우선순위</span>
              <div className="w-28">
                <Select
                  value={ticket.priority}
                  onValueChange={(v) => priorityMutation.mutate(v as TicketPriority)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => (
                      <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* 탭 */}
        <div className="flex border-b border-border-default shrink-0">
          {(
            [
              'activity',
              'details',
              ...(ticket?.request_type === 'installation' ? ['installation'] : []),
            ] as SliderTab[]
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'text-text-primary border-b-2 border-brand'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {tab === 'activity'
                ? '활동'
                : tab === 'details'
                  ? '상세정보'
                  : '설치'}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <div className="flex-1 overflow-hidden min-h-0">
          {activeTab === 'activity' && ticketId && (
            <ActivityTab ticketId={ticketId} tenantSlug={tenantSlug} />
          )}

          {activeTab === 'installation' && ticketId && (
            <InstallationStepPanel ticketId={ticketId} tenantSlug={tenantSlug} />
          )}

          {activeTab === 'details' && (
            <div className="p-5 overflow-y-auto h-full">
              {ticketLoading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : ticket ? (
                <DetailsTab ticket={ticket} />
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
