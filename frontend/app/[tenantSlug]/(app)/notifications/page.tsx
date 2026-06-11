'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  NotifLog,
  NotifLogsResponse,
  NotifChannel,
  NotifStatus,
  ChannelStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove } from '@/lib/auth';

// -----------------------------------------------------------------------
// 상수 매핑
// -----------------------------------------------------------------------
const CHANNEL_LABELS: Record<NotifChannel, string> = {
  kakao: '카카오톡',
  sms: 'SMS',
  slack: 'Slack',
  teams: 'Teams',
};

const STATUS_STYLES: Record<NotifStatus, string> = {
  sent:    'bg-success-bg text-success-text',
  failed:  'bg-error-bg text-error-text',
  skipped: 'bg-neutral-100 text-neutral-500',
};

const STATUS_LABELS: Record<NotifStatus, string> = {
  sent:    '발송됨',
  failed:  '실패',
  skipped: '건너뜀',
};

const EVENT_LABELS: Record<string, string> = {
  ticket_created:      '티켓 생성',
  ticket_resolved:     '티켓 해결',
  sla_breach_warning:  'SLA 경고',
  sla_breached:        'SLA 침해',
};

function getEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

// -----------------------------------------------------------------------
// 채널 상태 카드
// -----------------------------------------------------------------------
function ChannelStatusCard({
  channel,
  configured,
}: {
  channel: NotifChannel;
  configured: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border-default bg-surface px-4 py-3">
      <span className="text-sm font-medium text-text-primary">
        {CHANNEL_LABELS[channel]}
      </span>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
          configured
            ? 'bg-success-bg text-success-text'
            : 'bg-neutral-100 text-neutral-500',
        )}
      >
        {configured ? '활성' : '미설정'}
      </span>
    </div>
  );
}

function ChannelStatusSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border-default bg-surface px-4 py-3">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-5 w-14 rounded-full" />
    </div>
  );
}

// -----------------------------------------------------------------------
// 상태 배지
// -----------------------------------------------------------------------
function StatusBadge({ status }: { status: NotifStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 스켈레톤 행
// -----------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
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
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(245, 192, 0, 0.12)' }}
          >
            <Bell size={28} strokeWidth={1.5} style={{ color: '#F5C000' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">알림 내역 없음</p>
            <p className="mt-1 text-sm text-text-secondary">
              알림 내역이 없습니다.
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 페이지네이션
// -----------------------------------------------------------------------
function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border-subtle">
      <Button
        size="sm"
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        이전
      </Button>
      <span className="text-xs text-text-secondary">
        {page} / {totalPages}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        다음
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------
// 알림 로그 페이지
// -----------------------------------------------------------------------
export default function NotificationsPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const { user } = useAuth();

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState<string>('');

  const canViewChannelStatus = isTeamLeadOrAbove(user?.role);

  // 채널 상태 쿼리 (admin/team_lead만)
  const { data: channelStatus, isLoading: channelStatusLoading } =
    useQuery<ChannelStatus>({
      queryKey: ['notification-channel-status', tenantSlug],
      queryFn: () =>
        api
          .get(`/${tenantSlug}/notifications/channel-status`)
          .then((r) => r.data),
      enabled: !!tenantSlug && canViewChannelStatus,
    });

  // 알림 로그 쿼리
  const { data, isLoading } = useQuery<NotifLogsResponse>({
    queryKey: ['notification-logs', tenantSlug, channelFilter, page],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/notifications`, {
          params: {
            page,
            page_size: PAGE_SIZE,
            ...(channelFilter ? { channel: channelFilter } : {}),
          },
        })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const items: NotifLog[] = data?.items ?? [];
  const total = data?.total ?? 0;

  function handleChannelFilterChange(value: string) {
    setChannelFilter(value === 'all' ? '' : value);
    setPage(1);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">알림</h1>
      </div>

      {/* 채널 상태 카드 (admin/team_lead만) */}
      {canViewChannelStatus && (
        <div className="px-6 py-4 border-b border-border-subtle bg-surface shrink-0">
          <h2 className="text-sm font-medium text-text-secondary mb-3">채널 상태</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {channelStatusLoading || !channelStatus ? (
              <>
                <ChannelStatusSkeleton />
                <ChannelStatusSkeleton />
                <ChannelStatusSkeleton />
                <ChannelStatusSkeleton />
              </>
            ) : (
              (['kakao', 'sms', 'slack', 'teams'] as NotifChannel[]).map((ch) => (
                <ChannelStatusCard
                  key={ch}
                  channel={ch}
                  configured={channelStatus[ch]?.configured ?? false}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* 필터 바 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface shrink-0">
        <div className="w-36">
          <Select
            value={channelFilter || 'all'}
            onValueChange={handleChannelFilterChange}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="채널 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">채널 전체</SelectItem>
              <SelectItem value="kakao">카카오톡</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="teams">Teams</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">채널</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이벤트</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">수신자</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">메시지 요약</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">시각</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : items.length === 0 ? (
              <EmptyState />
            ) : (
              items.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-border-subtle hover:bg-surface-hover transition-colors duration-micro"
                >
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {CHANNEL_LABELS[log.channel] ?? log.channel}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {getEventLabel(log.event_type)}
                  </td>
                  <td className="px-4 py-3 text-text-primary text-xs max-w-[160px] truncate">
                    {typeof log.recipient === 'string' ? log.recipient : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={log.status} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs max-w-[240px] truncate">
                    {typeof log.message_summary === 'string'
                      ? log.message_summary
                      : typeof log.error_msg === 'string'
                        ? log.error_msg
                        : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {formatRelativeTime(log.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}
