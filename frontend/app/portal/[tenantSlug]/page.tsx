'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Ticket, BookOpen, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';
import type { TicketStatus, TicketPriority } from '@/lib/types';

interface PortalTicket {
  id: string;
  ticket_number: string | null;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  contract_name: string | null;
  created_at: string;
  updated_at: string;
}

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

function SkeletonHome() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function PortalHomePage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const { data: allTickets, isLoading: ticketsLoading } = useQuery<PortalTicket[]>({
    queryKey: ['portal-tickets-home', tenantSlug],
    queryFn: async () => {
      const res = await api.get<PortalTicket[]>(`/portal/${tenantSlug}/tickets`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!user && !!tenantSlug,
    staleTime: 60_000,
  });

  if (authLoading) return <SkeletonHome />;

  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return <SkeletonHome />;
  }

  const activeTickets = (allTickets ?? []).filter((t) =>
    ['open', 'in_progress', 'pending'].includes(t.status),
  );
  const resolvedTickets = (allTickets ?? []).filter((t) =>
    ['resolved', 'closed'].includes(t.status),
  );
  const recentActive = activeTickets.slice(0, 3);

  return (
    <div className="flex flex-col gap-8">
      {/* 환영 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          안녕하세요, {user.name}님
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {user.company ? `${user.company} · ` : ''}IT 지원 포털에 오신 것을 환영합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border-default bg-surface p-4 flex flex-col gap-1">
          <p className="text-xs text-text-secondary">처리 중인 티켓</p>
          {ticketsLoading ? (
            <Skeleton className="h-8 w-10" />
          ) : (
            <p className="text-3xl font-bold text-text-primary">{activeTickets.length}</p>
          )}
        </div>
        <div className="rounded-xl border border-border-default bg-surface p-4 flex flex-col gap-1">
          <p className="text-xs text-text-secondary">해결된 티켓</p>
          {ticketsLoading ? (
            <Skeleton className="h-8 w-10" />
          ) : (
            <p className="text-3xl font-bold text-text-primary">{resolvedTickets.length}</p>
          )}
        </div>
        <div className="rounded-xl border border-border-default bg-surface p-4 flex flex-col gap-1">
          <p className="text-xs text-text-secondary">전체 티켓</p>
          {ticketsLoading ? (
            <Skeleton className="h-8 w-10" />
          ) : (
            <p className="text-3xl font-bold text-text-primary">{(allTickets ?? []).length}</p>
          )}
        </div>
      </div>

      {/* 진행중 티켓 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">진행 중인 티켓</h2>
          <button
            type="button"
            onClick={() => router.push(`/portal/${tenantSlug}/tickets`)}
            className="flex items-center gap-1 text-xs text-accent-500 hover:underline"
          >
            전체 보기
            <ChevronRight size={12} />
          </button>
        </div>

        {ticketsLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : recentActive.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 rounded-xl border border-border-subtle bg-surface">
            <Ticket size={24} className="text-text-disabled" />
            <p className="text-sm text-text-secondary">진행 중인 티켓이 없습니다.</p>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Plus size={13} />}
              onClick={() => router.push(`/portal/${tenantSlug}/tickets/new`)}
            >
              새 티켓 접수
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {recentActive.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() =>
                  router.push(`/portal/${tenantSlug}/tickets/${ticket.id}`)
                }
                className="bg-surface rounded-xl border border-border-default p-4 text-left hover:border-border-strong hover:shadow-sm transition-all duration-fast w-full"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {ticket.ticket_number && (
                      <span className="shrink-0 text-xs text-text-secondary font-mono">
                        {ticket.ticket_number}
                      </span>
                    )}
                    <p className="text-sm font-medium text-text-primary line-clamp-1 flex-1">
                      {ticket.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={STATUS_VARIANT[ticket.status]}>
                      {STATUS_LABEL[ticket.status]}
                    </Badge>
                    {ticket.contract_name && (
                      <span className="text-xs text-text-secondary">{ticket.contract_name}</span>
                    )}
                    <span className="ml-auto text-xs text-text-secondary">
                      {formatRelativeTime(ticket.updated_at)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 빠른 액션 */}
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-primary">빠른 액션</h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => router.push(`/portal/${tenantSlug}/tickets/new`)}
            className="flex items-center gap-3 rounded-xl border border-border-default bg-surface p-4 text-left hover:border-border-strong hover:shadow-sm transition-all duration-fast"
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'rgba(245, 192, 0, 0.12)' }}
            >
              <Plus size={20} style={{ color: '#F5C000' }} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">새 티켓 접수</p>
              <p className="text-xs text-text-secondary">IT 지원 요청하기</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => router.push(`/portal/${tenantSlug}/knowledge`)}
            className="flex items-center gap-3 rounded-xl border border-border-default bg-surface p-4 text-left hover:border-border-strong hover:shadow-sm transition-all duration-fast"
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'rgba(245, 192, 0, 0.12)' }}
            >
              <BookOpen size={20} style={{ color: '#F5C000' }} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">자주 묻는 질문</p>
              <p className="text-xs text-text-secondary">지식베이스 검색</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
