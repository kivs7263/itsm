'use client';

/**
 * portal/[tenantSlug]/tickets/[ticketId]/page.tsx — 포털 티켓 상세
 *
 * 보안: is_internal 댓글은 백엔드에서 필터링 (고객 노출 차단)
 * 타임라인: "접수됨" 시스템 이벤트 + 댓글/답변 통합 뷰
 * 댓글 입력: status가 closed/resolved가 아닐 때만 활성화
 */

import React, { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, CheckCircle, MessageSquare } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { TicketStatus, TicketPriority } from '@/lib/types';

interface PortalTicketDetail {
  id: string;
  ticket_number: string | null;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  channel: string;
  contract_name: string | null;
  assignee_name: string | null;
  sla_resolution_deadline: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface TimelineEvent {
  id: string;
  type: 'created' | 'comment';
  body: string | null;
  author_name: string | null;
  is_customer: boolean;
  created_at: string;
}

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '긴급',
};

const PRIORITY_VARIANT: Record<
  TicketPriority,
  'default' | 'info' | 'warning' | 'destructive'
> = {
  low: 'default',
  medium: 'info',
  high: 'warning',
  critical: 'destructive',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: '접수됨',
  in_progress: '처리중',
  pending: '대기중',
  resolved: '해결됨',
  closed: '종료됨',
};

const STATUS_VARIANT: Record<
  TicketStatus,
  'default' | 'info' | 'warning' | 'success' | 'destructive'
> = {
  open: 'info',
  in_progress: 'warning',
  pending: 'default',
  resolved: 'success',
  closed: 'default',
};

const CHANNEL_LABEL: Record<string, string> = {
  email: '이메일',
  phone: '전화',
  portal: '포털',
  internal: '내부',
};

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-24" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
      <div className="bg-surface rounded-xl border border-border-default p-4 flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineItem({ event }: { event: TimelineEvent }) {
  const isSystem = event.type === 'created';

  if (isSystem) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface border border-border-default">
          <CheckCircle size={14} className="text-text-secondary" />
        </div>
        <div className="flex-1 flex items-center gap-2">
          <span className="text-sm text-text-secondary">{event.body}</span>
          <span className="text-xs text-text-disabled">{formatRelativeTime(event.created_at)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3', event.is_customer ? 'flex-row-reverse' : 'flex-row')}>
      {/* 아바타 */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface border border-border-default">
        <MessageSquare size={13} className="text-text-secondary" />
      </div>

      {/* 말풍선 */}
      <div
        className={cn(
          'flex flex-col gap-1 max-w-[75%]',
          event.is_customer ? 'items-end' : 'items-start',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">
            {event.author_name}
          </span>
          <span className="text-xs text-text-disabled">
            {formatRelativeTime(event.created_at)}
          </span>
        </div>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
            event.is_customer
              ? 'bg-accent-500 text-white rounded-br-sm'
              : 'bg-surface border border-border-default text-text-primary rounded-bl-sm',
          )}
        >
          {event.body}
        </div>
      </div>
    </div>
  );
}

export default function PortalTicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tenantSlug = params?.tenantSlug as string;
  const ticketId = params?.ticketId as string;

  const [commentBody, setCommentBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const { data: ticket, isLoading: ticketLoading } = useQuery<PortalTicketDetail>({
    queryKey: ['portal-ticket', tenantSlug, ticketId],
    queryFn: async () => {
      const res = await api.get<PortalTicketDetail>(
        `/portal/${tenantSlug}/tickets/${ticketId}`,
      );
      return res.data;
    },
    enabled: !!user && !!tenantSlug && !!ticketId,
    staleTime: 30_000,
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery<TimelineEvent[]>({
    queryKey: ['portal-ticket-timeline', tenantSlug, ticketId],
    queryFn: async () => {
      const res = await api.get<TimelineEvent[]>(
        `/portal/${tenantSlug}/tickets/${ticketId}/timeline`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!user && !!tenantSlug && !!ticketId,
    staleTime: 30_000,
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      await api.post(`/portal/${tenantSlug}/tickets/${ticketId}/comments`, { body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['portal-ticket-timeline', tenantSlug, ticketId],
      });
      setCommentBody('');
      textareaRef.current?.focus();
    },
  });

  if (authLoading) return <DetailSkeleton />;

  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return <DetailSkeleton />;
  }

  if (ticketLoading) return <DetailSkeleton />;

  if (!ticket) {
    return (
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={() => router.push(`/portal/${tenantSlug}/tickets`)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast w-fit"
        >
          <ArrowLeft size={14} />
          목록으로
        </button>
        <p className="text-sm text-text-secondary">티켓을 찾을 수 없습니다.</p>
      </div>
    );
  }

  const isClosed = ticket.status === 'closed' || ticket.status === 'resolved';

  return (
    <div className="flex flex-col gap-6">
      {/* 뒤로가기 */}
      <button
        type="button"
        onClick={() => router.push(`/portal/${tenantSlug}/tickets`)}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast w-fit"
      >
        <ArrowLeft size={14} />
        목록으로
      </button>

      {/* 제목 + 배지 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          {ticket.ticket_number && (
            <span className="mt-1 shrink-0 text-xs text-text-secondary font-mono">
              {ticket.ticket_number}
            </span>
          )}
          <h1 className="text-xl font-bold text-text-primary">{ticket.title}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={STATUS_VARIANT[ticket.status]}>
            {STATUS_LABEL[ticket.status]}
          </Badge>
          <Badge variant={PRIORITY_VARIANT[ticket.priority]}>
            {PRIORITY_LABEL[ticket.priority]}
          </Badge>
        </div>
      </div>

      {/* 정보 카드 */}
      <div className="bg-surface rounded-xl border border-border-default p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-text-secondary">접수일</dt>
            <dd className="mt-0.5 font-medium text-text-primary">
              {new Date(ticket.created_at).toLocaleDateString('ko-KR')}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">담당자</dt>
            <dd className="mt-0.5 font-medium text-text-primary">
              {ticket.assignee_name ?? '미배정'}
            </dd>
          </div>
          {ticket.contract_name && (
            <div>
              <dt className="text-text-secondary">계약</dt>
              <dd className="mt-0.5 font-medium text-text-primary">{ticket.contract_name}</dd>
            </div>
          )}
          <div>
            <dt className="text-text-secondary">채널</dt>
            <dd className="mt-0.5 font-medium text-text-primary">
              {CHANNEL_LABEL[ticket.channel] ?? ticket.channel}
            </dd>
          </div>
          {ticket.sla_resolution_deadline && (
            <div className="col-span-2">
              <dt className="text-text-secondary">해결 기한</dt>
              <dd className="mt-0.5 font-medium text-text-primary">
                {new Date(ticket.sla_resolution_deadline).toLocaleString('ko-KR')}
              </dd>
            </div>
          )}
          {ticket.description && (
            <div className="col-span-2">
              <dt className="text-text-secondary">설명</dt>
              <dd className="mt-0.5 text-text-primary whitespace-pre-wrap">
                {ticket.description}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* 타임라인 */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-text-primary">진행 내역</h2>

        {timelineLoading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {(timeline ?? []).map((event) => (
              <TimelineItem key={event.id} event={event} />
            ))}
          </div>
        )}

        {/* 댓글 입력 */}
        {isClosed ? (
          <div className="rounded-xl border border-border-default bg-surface-hover px-4 py-3 text-sm text-text-secondary text-center">
            종료된 티켓에는 댓글을 추가할 수 없습니다.
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = commentBody.trim();
              if (!trimmed) return;
              commentMutation.mutate(trimmed);
            }}
            className="flex gap-2 items-end"
          >
            <textarea
              ref={textareaRef}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="메시지를 입력하세요... (Ctrl+Enter로 전송)"
              rows={3}
              className={cn(
                'flex-1 resize-none rounded-xl border border-border-default bg-surface px-3 py-2.5',
                'text-sm text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500',
                'transition-colors duration-fast',
                'min-h-[44px]',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  const trimmed = commentBody.trim();
                  if (!trimmed) return;
                  commentMutation.mutate(trimmed);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              isLoading={commentMutation.isPending}
              disabled={!commentBody.trim() || commentMutation.isPending}
              aria-label="전송"
              className="h-11 w-11 shrink-0"
            >
              {!commentMutation.isPending && <Send size={14} />}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
