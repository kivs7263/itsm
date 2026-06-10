'use client';

/**
 * portal/[tenantSlug]/tickets/page.tsx — 포털 티켓 목록
 *
 * - 인증 보호: usePortalAuth → user null 이면 login 리다이렉트
 * - status 탭: 전체 / 처리중 / 해결됨
 * - 카드 스타일 목록 (테이블 아님)
 * - 로딩: Skeleton 카드 3개
 * - 빈 상태: 안내 메시지
 */

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Ticket } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';
import type { TicketStatus, TicketPriority } from '@/lib/types';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------
interface PortalTicket {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
}

type StatusFilter = 'all' | 'active' | 'resolved';

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

// -----------------------------------------------------------------------
// 스켈레톤 카드
// -----------------------------------------------------------------------
function SkeletonCard() {
  return (
    <div className="bg-surface rounded-xl border border-border-default p-4 flex flex-col gap-3">
      <Skeleton className="h-5 w-3/4" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-4 w-24 ml-auto" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function PortalTicketsPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  const [activeTab, setActiveTab] = useState<StatusFilter>('all');

  // 모든 hook은 조건부 return 이전에 선언
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  // status 탭에 따른 API 쿼리 파라미터
  const statusParam =
    activeTab === 'active'
      ? 'open,in_progress,pending'
      : activeTab === 'resolved'
        ? 'resolved,closed'
        : undefined;

  const { data: tickets, isLoading: ticketsLoading } = useQuery<PortalTicket[]>({
    queryKey: ['portal-tickets', tenantSlug, statusParam],
    queryFn: async () => {
      const url = statusParam
        ? `/portal/${tenantSlug}/tickets?status=${statusParam}`
        : `/portal/${tenantSlug}/tickets`;
      const response = await api.get<PortalTicket[]>(url);
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: !!user && !!tenantSlug,
    staleTime: 60 * 1000,
  });

  // 인증 로딩 중 → 스켈레톤
  if (authLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  // 미인증 → login 리다이렉트
  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'active', label: '처리중' },
    { key: 'resolved', label: '해결됨' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">내 티켓</h1>
        <Button
          size="md"
          leftIcon={<Plus size={14} />}
          onClick={() => router.push(`/portal/${tenantSlug}/tickets/new`)}
        >
          새 티켓 접수
        </Button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border-default">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors duration-fast',
              'border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-accent-500 text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {ticketsLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : !tickets || tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
            <Ticket size={22} className="text-text-secondary" />
          </div>
          <p className="text-sm text-text-secondary">접수한 티켓이 없습니다</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/portal/${tenantSlug}/tickets/new`)}
          >
            첫 티켓 접수하기
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() =>
                router.push(`/portal/${tenantSlug}/tickets/${ticket.id}`)
              }
              className="bg-surface rounded-xl border border-border-default p-4 text-left hover:border-border-strong hover:shadow-sm transition-all duration-fast w-full"
            >
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-text-primary line-clamp-2">
                  {ticket.title}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={PRIORITY_VARIANT[ticket.priority]}>
                    {PRIORITY_LABEL[ticket.priority]}
                  </Badge>
                  <Badge variant={STATUS_VARIANT[ticket.status]}>
                    {STATUS_LABEL[ticket.status]}
                  </Badge>
                  <span className="ml-auto text-xs text-text-secondary">
                    {formatRelativeTime(ticket.created_at)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
