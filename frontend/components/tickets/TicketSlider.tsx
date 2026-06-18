'use client';

import * as React from 'react';
import { X, ExternalLink, Sparkles, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Ticket, TicketStatus, TicketPriority } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SlaBadge } from './SlaBadge';
import { Button } from '@/components/ui/button';
import { EscalationModal } from './EscalationModal';
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
// KB 제안 섹션 (AI-3)
// -----------------------------------------------------------------------
function KbSuggestionsSection({ ticketId, tenantSlug }: { ticketId: string; tenantSlug: string }) {
  const { data: suggestions = [], isLoading } = useQuery<
    { id: string; title: string; content: string; similarity: number }[]
  >({
    queryKey: ['kb-suggestions', tenantSlug, ticketId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets/${ticketId}/kb-suggestions`).then((r) => r.data),
    enabled: !!ticketId,
    staleTime: 5 * 60 * 1000,
  });

  if (!isLoading && suggestions.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-default bg-surface">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <Sparkles size={13} className="text-amber-500" />
        <span className="text-xs font-semibold text-text-primary">관련 KB 문서</span>
        {!isLoading && (
          <span className="text-[10px] text-text-tertiary ml-auto">AI 유사도 기반</span>
        )}
      </div>
      <div className="divide-y divide-border-subtle">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))
          : suggestions.map((s) => (
              <a
                key={s.id}
                href={`/${tenantSlug}/kb/${s.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover transition-colors group"
              >
                <BookOpen size={13} className="mt-0.5 shrink-0 text-text-tertiary group-hover:text-amber-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary line-clamp-1 group-hover:text-brand">
                    {s.title}
                  </p>
                  <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">{s.content}</p>
                </div>
                <span className="text-[10px] text-text-tertiary shrink-0 tabular-nums">
                  {Math.round(s.similarity * 100)}%
                </span>
              </a>
            ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// TicketSlider
// -----------------------------------------------------------------------
export function TicketSlider({ ticketId, open, onClose, tenantSlug }: TicketSliderProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<SliderTab>('activity');
  const [escModalOpen, setEscModalOpen] = React.useState(false);

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
    onSuccess: (_, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      toast.success('상태가 변경되었습니다.');
      // AI-4: resolved 전환 시 KB 초안 생성 제안
      if (newStatus === 'resolved' && ticketId) {
        toast('이 해결 과정을 KB 문서로 만드세요', {
          description: 'AI가 티켓 내용으로 초안을 자동 생성합니다.',
          action: {
            label: 'KB 작성',
            onClick: () => {
              window.open(`/${tenantSlug}/kb?from_ticket=${ticketId}`, '_blank');
            },
          },
          duration: 8000,
        });
      }
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
      {/* 에스컬레이션 모달 */}
      {ticketId && (
        <EscalationModal
          open={escModalOpen}
          onClose={() => setEscModalOpen(false)}
          ticketId={ticketId}
          tenantSlug={tenantSlug}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['ticket', tenantSlug, ticketId] });
            queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
          }}
        />
      )}

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
                {ticket.escalation_level != null && ticket.escalation_level > 1 && (
                  <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">
                    {ticket.escalation_level}차 대응
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {ticketId && (
              <Link href={`/${tenantSlug}/tickets/${ticketId}`}>
                <Button variant="ghost" size="icon" title="전체 화면으로 보기" className="h-8 w-8">
                  <ExternalLink size={16} />
                </Button>
              </Link>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              aria-label="닫기"
            >
              <X size={18} />
            </button>
          </div>
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
            <div className="ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEscModalOpen(true)}
                className="h-7 text-xs text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-900/20"
              >
                2차 이관
              </Button>
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
            <div className="p-5 overflow-y-auto h-full flex flex-col gap-5">
              {ticketLoading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : ticket ? (
                <>
                  <DetailsTab ticket={ticket} />
                  <KbSuggestionsSection ticketId={ticketId!} tenantSlug={tenantSlug} />
                </>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
