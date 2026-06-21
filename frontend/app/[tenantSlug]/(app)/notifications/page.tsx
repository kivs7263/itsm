'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  NotifLog,
  NotifLogsResponse,
  NotifChannel,
  NotifStatus,
  ChannelStatus,
  InboxNotification,
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
    <div className="flex items-center justify-between rounded-lg border border-border-default shadow-sm bg-surface px-4 py-3">
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
    <div className="flex items-center justify-between rounded-lg border border-border-default shadow-sm bg-surface px-4 py-3">
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
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <Bell size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
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
// event_namespace → 출처 서비스 라벨 매핑
// -----------------------------------------------------------------------
const NAMESPACE_SERVICE_LABEL: Record<string, string> = {
  sa_workspace: 'SA',
  groupware: 'GW',
  itsm: 'ITSM',
  calendar: 'Calendar',
};

function getSourceLabel(eventNamespace: string): string {
  // event_namespace = "sa_workspace.ticket_created" 형태 또는 단순 "sa_workspace"
  const prefix = eventNamespace.split('.')[0];
  return NAMESPACE_SERVICE_LABEL[prefix] ?? '플랫폼';
}

// -----------------------------------------------------------------------
// 통합 인박스 스켈레톤
// -----------------------------------------------------------------------
function InboxSkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 px-4 py-3 border-b border-border-subtle"
        >
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 통합 인박스 빈 상태
// -----------------------------------------------------------------------
function InboxEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: 'rgba(18, 155, 142, 0.10)' }}
      >
        <Layers size={20} strokeWidth={1.5} style={{ color: '#129B8E' }} />
      </div>
      <p className="text-sm text-text-secondary">통합 플랫폼 알림이 없습니다.</p>
    </div>
  );
}

// -----------------------------------------------------------------------
// 통합 인박스 항목
// -----------------------------------------------------------------------
function InboxItem({
  item,
  onRead,
}: {
  item: InboxNotification;
  onRead: (id: string) => void;
}) {
  const sourceLabel = getSourceLabel(item.event_namespace);

  function handleClick() {
    if (!item.is_read) {
      onRead(item.id);
    }
    if (item.action_url) {
      window.location.href = item.action_url;
    }
  }

  return (
    <div
      role={item.action_url || !item.is_read ? 'button' : undefined}
      tabIndex={item.action_url || !item.is_read ? 0 : undefined}
      onClick={item.action_url || !item.is_read ? handleClick : undefined}
      onKeyDown={
        item.action_url || !item.is_read
          ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }
          : undefined
      }
      className={cn(
        'flex items-start gap-3 px-4 py-3 border-b border-border-subtle transition-colors duration-micro',
        (item.action_url || !item.is_read) && 'cursor-pointer hover:bg-surface-hover',
        !item.is_read && 'bg-[rgba(18, 155, 142,0.04)]',
      )}
    >
      {/* 미읽음 점 */}
      <div className="mt-1.5 shrink-0">
        {!item.is_read ? (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: '#129B8E' }}
          />
        ) : (
          <span className="inline-block h-2 w-2" />
        )}
      </div>

      {/* 내용 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {/* 출처 라벨 */}
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              background: 'rgba(18, 155, 142,0.15)',
              color: '#B45309',
            }}
          >
            {sourceLabel}
          </span>
          <span className="text-xs font-medium text-text-primary truncate">
            {typeof item.title === 'string' ? item.title : ''}
          </span>
        </div>
        {typeof item.body === 'string' && item.body && (
          <p className="text-xs text-text-secondary line-clamp-2">{item.body}</p>
        )}
      </div>

      {/* 시각 */}
      <span className="shrink-0 text-[10px] text-text-secondary whitespace-nowrap mt-0.5">
        {formatRelativeTime(item.created_at)}
      </span>
    </div>
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
  const queryClient = useQueryClient();

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

  // 알림 로그 쿼리 (로컬 ITSM)
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

  // 통합 인박스 쿼리 (notification-service proxy — graceful fallback)
  const { data: inboxItems, isLoading: inboxLoading } = useQuery<InboxNotification[]>({
    queryKey: ['inbox-notifications'],
    queryFn: async () => {
      try {
        const r = await api.get<InboxNotification[]>('/notifications', {
          params: { limit: 50, offset: 0 },
        });
        return Array.isArray(r.data) ? r.data : [];
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });

  // 통합 인박스 읽음 mutation
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-unread-count'] });
    },
  });

  const items: NotifLog[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const inbox: InboxNotification[] = inboxItems ?? [];

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

      {/* 통합 인박스 섹션 (notification-service proxy) */}
      <div className="px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Layers size={14} style={{ color: '#129B8E' }} />
          <h2 className="text-sm font-medium text-text-secondary">플랫폼 통합 알림</h2>
          {inbox.filter((n) => !n.is_read).length > 0 && (
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ background: '#B45309' }}
            >
              {inbox.filter((n) => !n.is_read).length}
            </span>
          )}
        </div>

        <div className="rounded-lg border border-border-subtle overflow-hidden">
          {inboxLoading ? (
            <InboxSkeletonRows />
          ) : inbox.length === 0 ? (
            <InboxEmptyState />
          ) : (
            inbox.map((item) => (
              <InboxItem
                key={item.id}
                item={item}
                onRead={(id) => markReadMutation.mutate(id)}
              />
            ))
          )}
        </div>
      </div>

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

      {/* ITSM 발송 로그 제목 */}
      <div className="flex items-center gap-2 px-6 pt-4 pb-2 bg-surface shrink-0">
        <Bell size={14} className="text-text-secondary" />
        <h2 className="text-sm font-medium text-text-secondary">ITSM 알림 발송 이력</h2>
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
