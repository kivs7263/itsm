'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, LifeBuoy, Inbox, UserPlus, Info, RotateCcw, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Ticket, TicketStatus, TicketPriority, TicketsResponse, UserSummary } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { isTeamLeadOrAbove, isAdminRole, type UserRole } from '@/lib/auth';
import { cn, formatRelativeTime, formatWorkHours } from '@/lib/utils';
import { SlaBadge } from '@/components/tickets/SlaBadge';
import { TicketSlider } from '@/components/tickets/TicketSlider';
import { CreateTicketModal } from '@/components/tickets/CreateTicketModal';
import { BulkActionBar } from '@/components/tickets/BulkActionBar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
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

// -----------------------------------------------------------------------
// 우선순위 배지
// -----------------------------------------------------------------------
const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low:      'bg-neutral-100 text-neutral-500',
  medium:   'bg-info-bg text-info-text',
  high:     'bg-warning-bg text-warning-text',
  critical: 'bg-error-bg text-error-text',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low:      '낮음',
  medium:   '보통',
  high:     '높음',
  critical: '긴급',
};

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        PRIORITY_STYLES[priority],
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 상태 배지
// -----------------------------------------------------------------------
const STATUS_STYLES: Record<TicketStatus, string> = {
  open:        'bg-status-open-bg text-status-open',
  in_progress: 'bg-info-bg text-info-text',
  pending:     'bg-status-pending-bg text-status-pending',
  resolved:    'bg-status-resolved-bg text-status-resolved',
  closed:      'bg-status-closed-bg text-status-closed',
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  open:        '열림',
  in_progress: '진행 중',
  pending:     '대기',
  resolved:    '해결됨',
  closed:      '닫힘',
};

function StatusBadge({ status }: { status: TicketStatus }) {
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
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="w-10 px-4 py-3"><Skeleton className="h-4 w-4" /></td>
          <td className="px-4 py-3 w-12"><Skeleton className="h-4 w-8" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-12 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-10" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 빈 상태
// -----------------------------------------------------------------------
function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <tr>
      <td colSpan={10}>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <LifeBuoy size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">티켓 없음</p>
            <p className="mt-1 text-sm text-text-secondary">
              조건에 맞는 티켓이 없습니다. 새 티켓을 생성해보세요.
            </p>
          </div>
          <Button size="sm" onClick={onNew} leftIcon={<Plus size={14} />}>
            새 티켓
          </Button>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 티켓 풀 타입
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
// FRP-3d-A1 queue/page.tsx AssignModal 이식 (RX-4c: queue → tickets 탭 병합)
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
// 티켓 풀 탭 (인라인) — RX-4c: /queue 페이지 병합 (claim·assign·SELECT FOR UPDATE 락 UX 이식)
// -----------------------------------------------------------------------
function QueueTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.role as UserRole);
  const [assignTarget, setAssignTarget] = useState<{ id: string; ticket_number: string | null } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<QueueResponse>({
    queryKey: ['queue', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/queue`).then((r) => r.data),
    enabled: !!tenantSlug,
    refetchInterval: 30_000,
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
      {/* 안내 배너 */}
      <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg bg-info-bg px-4 py-3 text-sm text-info-text shrink-0">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          선착순 접수 방식 — 먼저 클릭한 1인만 성공합니다. 동시 클릭 시 나머지는 자동 알림을 받습니다.
          {total > 0 && <strong className="ml-1">({total}개 대기 중)</strong>}
        </span>
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['queue', tenantSlug] })}
          className="ml-auto shrink-0 flex items-center gap-1 text-xs text-info-text hover:text-text-primary"
        >
          <RotateCcw size={12} />
          새로고침
        </button>
      </div>

      {/* 테이블 — ALVEO-V2 Track 4: 카드 래핑 (외곽 rounded+border는 overflow-hidden, 스크롤/sticky는 내부 div가 담당) */}
      <div className="mx-6 mb-4 mt-4 flex-1 min-h-0 flex flex-col rounded-[14px] border border-border-default bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex-1 overflow-auto min-h-0">
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
            ) : isError ? ( /* AS-W1 */
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
                  <AlertCircle size={32} className="mx-auto mb-3 text-error" />
                  <p className="text-sm text-text-secondary mb-3">데이터를 불러오지 못했습니다.</p>
                  <button
                    onClick={() => refetch()}
                    className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
                  >
                    <RefreshCw size={12} />
                    다시 시도
                  </button>
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(18, 155, 142, 0.12)' }}>
                      <Inbox size={24} strokeWidth={1.5} style={{ color: '#129B8E' }} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-text-primary">미배정 티켓 없음</p>
                      <p className="text-xs text-text-secondary mt-0.5">모든 티켓이 담당자에게 배정되었습니다.</p>
                    </div>
                  </div>
                </td>
              </tr>
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
                      PRIORITY_STYLES[t.priority as TicketPriority] ?? 'bg-neutral-100 text-neutral-500',
                    )}>
                      {PRIORITY_LABELS[t.priority as TicketPriority] ?? t.priority}
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

// -----------------------------------------------------------------------
// 필터 상태
// -----------------------------------------------------------------------
interface Filters {
  status: string;
  priority: string;
  search: string;
}

// -----------------------------------------------------------------------
// 티켓 목록 페이지
// RX-4c: /queue 페이지 병합 — ?view=pool 쿼리파라미터로 딥링크 진입 (redirect('/tickets?view=pool'))
// -----------------------------------------------------------------------
type TicketTab = 'my-tickets' | 'pool';

export default function TicketsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const tenantSlug = params?.tenantSlug as string;

  const initialTab: TicketTab = searchParams?.get('view') === 'pool' ? 'pool' : 'my-tickets';
  const [activeTab, setActiveTab] = useState<TicketTab>(initialTab);
  const [filters, setFilters] = useState<Filters>({
    status: '',
    priority: '',
    search: '',
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [sliderOpen, setSliderOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // 헤더 타이머에서 클릭 시 ?focus=<id> 로 넘어오면 슬라이더 자동 오픈
  useEffect(() => {
    const focusId = searchParams?.get('focus');
    if (focusId) {
      setSelectedTicketId(focusId);
      setSliderOpen(true);
    }
  }, [searchParams]);

  // RA-U5: 모바일 티켓 생성 FAB(/tickets?new=1)에서 넘어오면 생성 모달 자동 오픈
  useEffect(() => {
    if (searchParams?.get('new') === '1') {
      setActiveTab('my-tickets');
      setCreateOpen(true);
    }
  }, [searchParams]);

  // 티켓 목록 조회
  const { data, isLoading, isError, refetch } = useQuery<TicketsResponse>({
    queryKey: ['tickets', tenantSlug, filters],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/tickets`, {
          params: {
            ...(filters.status   ? { status:   filters.status }   : {}),
            ...(filters.priority ? { priority: filters.priority } : {}),
            ...(filters.search   ? { search:   filters.search }   : {}),
          },
        })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const tickets: Ticket[] = data?.items ?? [];

  // 전체 선택
  const allChecked = tickets.length > 0 && selectedIds.length === tickets.length;
  const someChecked = selectedIds.length > 0 && selectedIds.length < tickets.length;

  function toggleAll() {
    if (allChecked) {
      setSelectedIds([]);
    } else {
      setSelectedIds(tickets.map((t) => t.id));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleRowClick(id: string) {
    setSelectedTicketId(id);
    setSliderOpen(true);
  }

  const handleClearBulk = useCallback(() => setSelectedIds([]), []);

  return (
    <div className="flex flex-col h-full">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="v2-page-title text-text-primary">티켓</h1>
          {/* 탭 토글 */}
          <div className="flex gap-0.5 p-0.5 rounded-lg bg-border-subtle">
            <button
              type="button"
              onClick={() => setActiveTab('my-tickets')}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-fast',
                activeTab === 'my-tickets'
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              내 티켓
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pool')}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-fast',
                activeTab === 'pool'
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              티켓 풀
            </button>
          </div>
        </div>
        {activeTab === 'my-tickets' && (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            leftIcon={<Plus size={14} />}
          >
            새 티켓
          </Button>
        )}
      </div>

      {/* 티켓 풀 탭 */}
      {activeTab === 'pool' && <QueueTab tenantSlug={tenantSlug} />}

      {/* 내 티켓 탭 — 필터 바 + 테이블 */}
      {activeTab === 'my-tickets' && (
      <>

      {/* 필터 바 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface shrink-0 flex-wrap">
        {/* 텍스트 검색 */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="티켓 검색..."
            className="h-8 pl-8 pr-3 w-48 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>

        {/* 상태 필터 */}
        <div className="w-36">
          <Select
            value={filters.status || 'all'}
            onValueChange={(v) =>
              setFilters((prev) => ({ ...prev, status: v === 'all' ? '' : v }))
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="상태 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">상태 전체</SelectItem>
              <SelectItem value="open">열림</SelectItem>
              <SelectItem value="in_progress">진행 중</SelectItem>
              <SelectItem value="pending">대기</SelectItem>
              <SelectItem value="resolved">해결됨</SelectItem>
              <SelectItem value="closed">닫힘</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 우선순위 필터 */}
        <div className="w-36">
          <Select
            value={filters.priority || 'all'}
            onValueChange={(v) =>
              setFilters((prev) => ({ ...prev, priority: v === 'all' ? '' : v }))
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="우선순위 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">우선순위 전체</SelectItem>
              <SelectItem value="low">낮음</SelectItem>
              <SelectItem value="medium">보통</SelectItem>
              <SelectItem value="high">높음</SelectItem>
              <SelectItem value="critical">긴급</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 테이블 — ALVEO-V2 Track 4: 카드 래핑 (외곽 rounded+border는 overflow-hidden, 스크롤/sticky는 내부 div가 담당) */}
      <div className="mx-6 mb-4 mt-4 flex-1 min-h-0 flex flex-col rounded-[14px] border border-border-default bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="w-10 px-4 py-3">
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={toggleAll}
                  aria-label="전체 선택"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary w-12">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">제목</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">고객</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">담당자</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">우선순위</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">작업 시간</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">SLA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">생성일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : isError ? ( /* AS-W1 */
              <tr>
                <td colSpan={10} className="px-4 py-16 text-center">
                  <AlertCircle size={32} className="mx-auto mb-3 text-error" />
                  <p className="text-sm text-text-secondary mb-3">데이터를 불러오지 못했습니다.</p>
                  <button
                    onClick={() => refetch()}
                    className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
                  >
                    <RefreshCw size={12} />
                    다시 시도
                  </button>
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <EmptyState onNew={() => setCreateOpen(true)} />
            ) : (
              tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => handleRowClick(ticket.id)}
                  className={cn(
                    'border-b border-border-subtle cursor-pointer',
                    'hover:bg-surface-hover transition-colors duration-micro',
                    selectedIds.includes(ticket.id) && 'bg-accent-100/30',
                  )}
                >
                  {/* 체크박스 */}
                  <td
                    className="px-4 py-3"
                    onClick={(e) => { e.stopPropagation(); toggleOne(ticket.id); }}
                  >
                    <Checkbox
                      checked={selectedIds.includes(ticket.id)}
                      onChange={() => toggleOne(ticket.id)}
                      aria-label={`티켓 ${ticket.id} 선택`}
                    />
                  </td>

                  {/* # */}
                  <td className="px-4 py-3 text-text-secondary text-xs font-mono tabular-nums">
                    {ticket.ticket_number ?? '-'}
                  </td>

                  {/* 제목 */}
                  <td className="px-4 py-3 max-w-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="line-clamp-1 text-text-primary font-medium">
                        {ticket.title}
                      </span>
                      {ticket.is_recurring_flag && (
                        <span className="shrink-0 inline-flex items-center rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning-text">
                          반복
                        </span>
                      )}
                    </div>
                  </td>

                  {/* 고객 */}
                  <td className="px-4 py-3 text-text-secondary">
                    {typeof ticket.customer_name === 'string'
                      ? ticket.customer_name
                      : '-'}
                  </td>

                  {/* 담당자 */}
                  <td className="px-4 py-3 text-text-secondary">
                    {typeof ticket.assignee_name === 'string'
                      ? ticket.assignee_name
                      : '-'}
                  </td>

                  {/* 우선순위 배지 */}
                  <td className="px-4 py-3">
                    <PriorityBadge priority={ticket.priority} />
                  </td>

                  {/* 상태 배지 */}
                  <td className="px-4 py-3">
                    <StatusBadge status={ticket.status} />
                  </td>

                  {/* 누적 공수 */}
                  <td className="px-4 py-3 text-xs tabular-nums">
                    {(ticket as any).total_hours > 0
                      ? <span className="text-text-primary font-medium">{formatWorkHours((ticket as any).total_hours)}</span>
                      : <span className="text-text-disabled">-</span>
                    }
                  </td>

                  {/* SLA 배지 */}
                  <td className="px-4 py-3">
                    <SlaBadge
                      deadline={ticket.sla_response_deadline}
                      label="응답"
                    />
                  </td>

                  {/* 생성일 */}
                  <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {formatRelativeTime(ticket.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      {/* 티켓 상세 슬라이더 */}
      <TicketSlider
        ticketId={selectedTicketId}
        open={sliderOpen}
        onClose={() => setSliderOpen(false)}
        tenantSlug={tenantSlug}
      />

      {/* 생성 모달 */}
      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />

      {/* 대량 작업 바 */}
      <BulkActionBar
        selectedIds={selectedIds}
        onClear={handleClearBulk}
        tenantSlug={tenantSlug}
      />
      </>
      )}
    </div>
  );
}
