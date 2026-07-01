'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, UserPlus, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isAdminRole, type UserRole } from '@/lib/auth';
import type { UserSummary } from '@/lib/types';

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
// 배정 모달 (admin 전용 — user list는 admin만 조회 가능)
// -----------------------------------------------------------------------
interface AssignModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  ticketId: string;
  ticketNumber: string | null;
}

interface UsersResponse {
  items: UserSummary[];
  total: number;
}

function AssignModal({ open, onClose, tenantSlug, ticketId, ticketNumber }: AssignModalProps) {
  const queryClient = useQueryClient();
  const [selectedEngineerId, setSelectedEngineerId] = useState('');

  const { data: usersData, isLoading: usersLoading } = useQuery<UsersResponse>({
    queryKey: ['queue-users', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/settings/users`).then((r) => r.data),
    enabled: open && !!tenantSlug,
    staleTime: 60_000,
  });

  const users: UserSummary[] = Array.isArray(usersData?.items)
    ? usersData.items.filter((u) => u.is_active)
    : [];

  const assignMutation = useMutation({
    mutationFn: () =>
      api
        .post(`/${tenantSlug}/queue/${ticketId}/assign`, { engineer_id: selectedEngineerId })
        .then((r) => r.data),
    onSuccess: (ticket) => {
      toast.success(`티켓 ${ticketNumber ?? ticketId.slice(0, 8)} 배정 완료`);
      queryClient.invalidateQueries({ queryKey: ['queue', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      onClose();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  function handleClose() {
    setSelectedEngineerId('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>엔지니어 배정</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-text-secondary">
            티켓 <span className="font-mono font-medium text-text-primary">{ticketNumber ?? ticketId.slice(0, 8)}</span>에 담당 엔지니어를 배정합니다.
          </p>
          {usersLoading ? (
            <Skeleton className="h-9 w-full rounded-md" />
          ) : users.length === 0 ? (
            <p className="text-sm text-text-disabled">활성 사용자가 없습니다.</p>
          ) : (
            <Select value={selectedEngineerId} onValueChange={setSelectedEngineerId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="담당자 선택" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={assignMutation.isPending}>취소</Button>
          <Button
            onClick={() => assignMutation.mutate()}
            isLoading={assignMutation.isPending}
            disabled={!selectedEngineerId || assignMutation.isPending}
            leftIcon={<UserPlus size={14} />}
          >
            배정
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const isAdmin = isAdminRole(user?.role as UserRole);

  const [assignTarget, setAssignTarget] = useState<{ id: string; ticket_number: string | null } | null>(null);

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
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      {/* 관리자 전용: 엔지니어 직접 배정 */}
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={<UserPlus size={13} />}
                          onClick={() => setAssignTarget({ id: t.id, ticket_number: t.ticket_number })}
                        >
                          배정
                        </Button>
                      )}
                      {/* 선착순 접수 */}
                      <Button
                        size="sm"
                        variant="ghost"
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

      {/* 배정 모달 (admin 전용) */}
      {assignTarget && (
        <AssignModal
          open={!!assignTarget}
          onClose={() => setAssignTarget(null)}
          tenantSlug={tenantSlug}
          ticketId={assignTarget.id}
          ticketNumber={assignTarget.ticket_number}
        />
      )}
    </div>
  );
}
