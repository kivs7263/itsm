'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, UserPlus, RotateCcw, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, type UserRole } from '@/lib/auth';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------
interface QueueTicket {
  id: string;
  ticket_number: string | null;
  title: string;
  priority: string;
  request_type: string | null;
  customer_id: string | null;
  assigned_to: string | null;
  created_at: string;
}

interface QueueResponse {
  items: QueueTicket[];
  total: number;
  page: number;
  page_size: number;
}

// -----------------------------------------------------------------------
// 우선순위 배지
// -----------------------------------------------------------------------
const PRIORITY_STYLES: Record<string, string> = {
  low:      'bg-neutral-100 text-neutral-500',
  medium:   'bg-info-bg text-info-text',
  high:     'bg-warning-bg text-warning-text',
  critical: 'bg-error-bg text-error-text',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: '낮음', medium: '보통', high: '높음', critical: '긴급',
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  incident:          '장애',
  service_request:   '서비스 요청',
  installation:      '설치',
  upgrade:           '업그레이드',
  technical_inquiry: '기술 문의',
  maintenance:       '유지보수',
};

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
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
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <Inbox size={24} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-primary">미배정 티켓 없음</p>
            <p className="text-xs text-text-secondary mt-0.5">모든 티켓이 담당자에게 배정되었습니다.</p>
          </div>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 티켓 풀 페이지
// -----------------------------------------------------------------------
export default function QueuePage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isManager = isTeamLeadOrAbove(user?.role as UserRole);

  const { data, isLoading } = useQuery<QueueResponse>({
    queryKey: ['queue', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/queue`).then((r) => r.data),
    enabled: !!tenantSlug,
    refetchInterval: 30_000, // 30초 polling
  });

  const claimMutation = useMutation({
    mutationFn: (ticketId: string) =>
      api.post(`/${tenantSlug}/queue/${ticketId}/claim`).then((r) => r.data),
    onSuccess: (ticket) => {
      toast.success(`티켓 ${ticket.ticket_number ?? ticket.id.slice(0, 8)} 접수 완료`);
      queryClient.invalidateQueries({ queryKey: ['queue', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
      queryClient.invalidateQueries({ queryKey: ['queue', tenantSlug] });
    },
  });

  const tickets = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-text-primary">티켓 풀</h1>
          {total > 0 && (
            <span className="flex items-center justify-center h-5 min-w-5 rounded-full bg-error text-white text-[10px] font-bold px-1.5">
              {total}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['queue', tenantSlug] })}
        >
          새로고침
        </Button>
      </div>

      {/* 안내 배너 */}
      <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg bg-info-bg px-4 py-3 text-sm text-info-text shrink-0">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>선착순 접수 방식 — 먼저 클릭한 1인만 성공합니다. 동시 클릭 시 나머지는 자동 알림을 받습니다.</span>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0 mt-4">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">번호</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">제목</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">우선순위</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">유형</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">접수일</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary">액션</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : tickets.length === 0 ? (
              <EmptyState />
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="border-b border-border-subtle hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                    {t.ticket_number ?? t.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-text-primary max-w-xs">
                    <p className="truncate">{t.title}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      PRIORITY_STYLES[t.priority] ?? 'bg-neutral-100 text-neutral-500',
                    )}>
                      {PRIORITY_LABELS[t.priority] ?? t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {t.request_type ? (REQUEST_TYPE_LABELS[t.request_type] ?? t.request_type) : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatRelativeTime(t.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<UserPlus size={13} />}
                        onClick={() => claimMutation.mutate(t.id)}
                        isLoading={claimMutation.isPending && claimMutation.variables === t.id}
                        disabled={claimMutation.isPending}
                      >
                        접수
                      </Button>
                    </div>
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
