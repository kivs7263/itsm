'use client';

/**
 * portal/[tenantSlug]/tickets/[ticketId]/page.tsx — 포털 티켓 상세
 *
 * 보안: is_internal === true 댓글은 절대 렌더링 금지 (고객 노출 차단)
 * 댓글 입력: status가 closed/resolved가 아닐 때만 활성화
 */

import React, { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { Ticket, TicketComment, TicketStatus, TicketPriority } from '@/lib/types';

// -----------------------------------------------------------------------
// 배지 헬퍼
// -----------------------------------------------------------------------
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

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
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
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function PortalTicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tenantSlug = params?.tenantSlug as string;
  const ticketId = params?.ticketId as string;

  const [commentBody, setCommentBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 모든 hook은 조건부 return 이전에 선언
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const { data: ticket, isLoading: ticketLoading } = useQuery<Ticket>({
    queryKey: ['portal-ticket', tenantSlug, ticketId],
    queryFn: async () => {
      const response = await api.get<Ticket>(
        `/portal/${tenantSlug}/tickets/${ticketId}`,
      );
      return response.data;
    },
    enabled: !!user && !!tenantSlug && !!ticketId,
    staleTime: 30 * 1000,
  });

  const { data: comments, isLoading: commentsLoading } = useQuery<
    TicketComment[]
  >({
    queryKey: ['portal-ticket-comments', tenantSlug, ticketId],
    queryFn: async () => {
      const response = await api.get<TicketComment[]>(
        `/portal/${tenantSlug}/tickets/${ticketId}/comments`,
      );
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: !!user && !!tenantSlug && !!ticketId,
    staleTime: 30 * 1000,
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      await api.post(
        `/portal/${tenantSlug}/tickets/${ticketId}/comments`,
        { body, is_internal: false },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['portal-ticket-comments', tenantSlug, ticketId],
      });
      setCommentBody('');
      textareaRef.current?.focus();
    },
  });

  // 인증 로딩 중
  if (authLoading) {
    return <DetailSkeleton />;
  }

  // 미인증
  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return <DetailSkeleton />;
  }

  // 티켓 로딩 중
  if (ticketLoading) {
    return <DetailSkeleton />;
  }

  // 티켓 없음
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

  const isClosed =
    ticket.status === 'closed' || ticket.status === 'resolved';

  // is_internal === true 댓글 필터링 — 고객에게 절대 노출 금지
  const publicComments = (comments ?? []).filter(
    (c) => c.is_internal === false,
  );

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
        <h1 className="text-xl font-bold text-text-primary">{ticket.title}</h1>
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
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
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
          <div>
            <dt className="text-text-secondary">채널</dt>
            <dd className="mt-0.5 font-medium text-text-primary">
              {CHANNEL_LABEL[ticket.channel] ?? ticket.channel}
            </dd>
          </div>
          {ticket.description && (
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-text-secondary">설명</dt>
              <dd className="mt-0.5 text-text-primary whitespace-pre-wrap">
                {ticket.description}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* 댓글 타임라인 */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-text-primary">대화 내용</h2>

        {commentsLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 w-3/4" />
            <Skeleton className="h-16 w-3/4 self-end" />
          </div>
        ) : publicComments.length === 0 ? (
          <p className="text-sm text-text-secondary py-4 text-center">
            아직 대화 내용이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {publicComments.map((comment) => {
              const isOwn = comment.author_id === user.id;
              return (
                <div
                  key={comment.id}
                  className={cn(
                    'flex flex-col gap-1 max-w-[80%]',
                    isOwn ? 'self-end items-end' : 'self-start items-start',
                  )}
                >
                  <span className="text-xs text-text-secondary px-1">
                    {comment.author_name}
                  </span>
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                      isOwn
                        ? 'bg-blue-500 text-white rounded-br-sm'
                        : 'bg-surface border border-border-default text-text-primary rounded-bl-sm',
                    )}
                  >
                    {comment.body}
                  </div>
                  <span className="text-xs text-text-secondary px-1">
                    {formatRelativeTime(comment.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* 댓글 입력창 — closed/resolved 이면 비활성화 */}
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
              placeholder="메시지를 입력하세요..."
              rows={3}
              className={cn(
                'flex-1 resize-none rounded-xl border border-border-default bg-surface px-3 py-2.5',
                'text-sm text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500',
                'transition-colors duration-fast',
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
            >
              {!commentMutation.isPending && <Send size={14} />}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
