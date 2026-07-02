'use client';

import React, { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Plus, Search, Users, ChevronRight, ChevronDown,
  Building2, GitBranch, LifeBuoy, Clock, Package, ScrollText,
  ArrowRight, Mail, Phone,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { CustomerTreeNode, CustomerRollup, Customer, Ticket, ContractTier } from '@/lib/types';
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

// -----------------------------------------------------------------------
// 계약 등급 배지
// -----------------------------------------------------------------------
const TIER_STYLES: Record<ContractTier, string> = {
  bronze:   'bg-orange-50 text-orange-700',
  silver:   'bg-neutral-100 text-neutral-600',
  gold:     'bg-yellow-50 text-yellow-700',
  platinum: 'bg-blue-50 text-blue-700',
};

const TIER_LABELS: Record<ContractTier, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
};

function TierBadge({ tier }: { tier: ContractTier | null }) {
  if (!tier) return null;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TIER_STYLES[tier])}>
      {TIER_LABELS[tier]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 트리 노드 컴포넌트
// -----------------------------------------------------------------------
function TreeNode({
  node,
  selectedId,
  onSelect,
  depth,
  searchQ,
}: {
  node: CustomerTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  searchQ: string;
}) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(depth === 0);

  const matchesSearch = searchQ.length === 0 ||
    node.name.toLowerCase().includes(searchQ.toLowerCase());

  const childrenMatchSearch = searchQ.length > 0 &&
    node.children.some((c) => c.name.toLowerCase().includes(searchQ.toLowerCase()));

  if (searchQ.length > 0 && !matchesSearch && !childrenMatchSearch) {
    return null;
  }

  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors duration-fast',
          'hover:bg-white/[0.06]',
          isSelected ? 'bg-white/[0.1] text-white' : 'text-white/70',
        )}
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        onClick={() => onSelect(node.id)}
      >
        {/* 확장 버튼 */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
            className="shrink-0 text-white/40 hover:text-white/80"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* 아이콘 */}
        {node.kind === 'account'
          ? <Building2 size={13} className={cn('shrink-0', isSelected ? 'text-[#129B8E]' : 'text-white/40')} />
          : <GitBranch size={13} className={cn('shrink-0', isSelected ? 'text-[#129B8E]' : 'text-white/40')} />
        }

        <span className="truncate text-xs">{node.name}</span>

        {hasChildren && (
          <span className="ml-auto shrink-0 text-[10px] text-white/30">
            {node.children.length}
          </span>
        )}
      </div>

      {/* 하위 부서 */}
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
              searchQ={searchQ}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 우측 패널 — 선택된 고객 요약
// -----------------------------------------------------------------------
function CustomerPanel({
  tenantSlug,
  customerId,
}: {
  tenantSlug: string;
  customerId: string;
}) {
  const router = useRouter();

  const { data: customer, isLoading: loadingCustomer } = useQuery<Customer>({
    queryKey: ['customer-detail', tenantSlug, customerId],
    queryFn: () => api.get(`/${tenantSlug}/customers/${customerId}`).then((r) => r.data),
    enabled: !!customerId,
  });

  const { data: rollup, isLoading: loadingRollup } = useQuery<CustomerRollup>({
    queryKey: ['customer-rollup', tenantSlug, customerId],
    queryFn: () => api.get(`/${tenantSlug}/customers/${customerId}/rollup`).then((r) => r.data),
    enabled: !!customerId,
  });

  const { data: ticketsData } = useQuery<{ items: Ticket[] }>({
    queryKey: ['customer-tickets-preview', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets`, { params: { customer_id: customerId, page_size: 5, status: 'open' } })
        .then((r) => r.data),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  const recentTickets = ticketsData?.items ?? [];

  if (loadingCustomer) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 고객 헤더 */}
      <div className="px-6 py-5 border-b border-border-subtle bg-surface shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-text-primary truncate">{customer.name}</h2>
              <span className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                customer.kind === 'account'
                  ? 'bg-info-bg text-info-text'
                  : 'bg-border-subtle text-text-secondary',
              )}>
                {customer.kind === 'account' ? '고객사' : '부서'}
              </span>
              {customer.contract_grade && (
                <TierBadge tier={customer.contract_grade as ContractTier} />
              )}
            </div>
            {customer.company && (
              <p className="mt-0.5 text-sm text-text-secondary truncate">{customer.company}</p>
            )}
            <div className="mt-1.5 flex items-center gap-4 text-xs text-text-disabled">
              {customer.email && (
                <span className="flex items-center gap-1">
                  <Mail size={11} />
                  {customer.email}
                </span>
              )}
              {customer.phone && (
                <span className="flex items-center gap-1">
                  <Phone size={11} />
                  {customer.phone}
                </span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            rightIcon={<ArrowRight size={13} />}
            onClick={() => router.push(`/${tenantSlug}/customers/${customerId}`)}
          >
            상세 보기
          </Button>
        </div>
      </div>

      {/* KPI 스트립 */}
      <div className="px-6 py-3 border-b border-border-subtle bg-surface-raised shrink-0">
        {loadingRollup ? (
          <div className="flex gap-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-24" />)}
          </div>
        ) : rollup ? (
          <div className="grid grid-cols-4 gap-4">
            <div className="flex flex-col">
              <span className="text-xs text-text-secondary">활성 티켓</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <LifeBuoy size={14} className="text-[#129B8E]" />
                <span className="text-base font-semibold text-text-primary">{rollup.open_tickets}</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-text-secondary">이달 공수</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Clock size={14} className="text-info-text" />
                <span className="text-base font-semibold text-text-primary">{rollup.total_hours_this_month.toFixed(1)}h</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-text-secondary">자산</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Package size={14} className="text-text-secondary" />
                <span className="text-base font-semibold text-text-primary">{rollup.active_assets}</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-text-secondary">계약</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <ScrollText size={14} className="text-text-secondary" />
                <span className="text-base font-semibold text-text-primary">{rollup.active_contracts}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 최근 활성 티켓 */}
      <div className="px-6 py-4 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">활성 티켓</h3>
          <button
            type="button"
            className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1"
            onClick={() => router.push(`/${tenantSlug}/customers/${customerId}`)}
          >
            전체 보기 <ArrowRight size={11} />
          </button>
        </div>

        {recentTickets.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-text-secondary">활성 티켓이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentTickets.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface px-3 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer"
                onClick={() => router.push(`/${tenantSlug}/tickets/${t.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">{t.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {t.ticket_number} · {formatRelativeTime(t.created_at)}
                  </p>
                </div>
                <span className={cn(
                  'ml-3 shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                  t.priority === 'critical' ? 'bg-error-bg text-error-text' :
                  t.priority === 'high' ? 'bg-warning-bg text-warning-text' :
                  t.priority === 'medium' ? 'bg-info-bg text-info-text' :
                  'bg-border-subtle text-text-secondary',
                )}>
                  {t.priority === 'critical' ? '긴급' : t.priority === 'high' ? '높음' : t.priority === 'medium' ? '보통' : '낮음'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 빈 선택 상태
// -----------------------------------------------------------------------
function EmptySelection() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(18, 155, 142, 0.08)' }}
      >
        <Users size={32} strokeWidth={1.5} style={{ color: '#129B8E' }} />
      </div>
      <div>
        <p className="text-sm font-medium text-text-primary">고객을 선택하세요</p>
        <p className="mt-1 text-xs text-text-secondary">왼쪽 목록에서 고객사 또는 부서를 선택하면<br/>KPI와 활성 티켓을 확인할 수 있습니다.</p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 새 고객 모달
// -----------------------------------------------------------------------
const createCustomerSchema = z.object({
  name:          z.string().min(1, '이름을 입력해주세요.'),
  company:       z.string().optional(),
  email:         z.string().email('올바른 이메일을 입력해주세요.').optional().or(z.literal('')),
  phone:         z.string().optional(),
  contract_tier: z.string().optional(),
});

type CreateCustomerValues = z.infer<typeof createCustomerSchema>;

function FormField({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">
        {label}{required && <span className="ml-0.5 text-error">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-error-text">{error}</p>}
    </div>
  );
}

function CreateCustomerModal({ open, onClose, tenantSlug }: { open: boolean; onClose: () => void; tenantSlug: string }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<CreateCustomerValues>({
    resolver: zodResolver(createCustomerSchema),
  });
  const tier = watch('contract_tier');

  function handleClose() { reset(); onClose(); }

  async function onSubmit(values: CreateCustomerValues) {
    try {
      await api.post(`/${tenantSlug}/customers`, {
        name:          values.name,
        company:       values.company || null,
        email:         values.email || null,
        phone:         values.phone || null,
        contract_grade: values.contract_tier || null,
        kind:          'account',
      });
      toast.success('고객이 생성되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['customers-tree', tenantSlug] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 고객 추가</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-0">
          <div className="flex flex-col gap-4">
            <FormField label="이름" required error={errors.name?.message}>
              <input {...register('name')} placeholder="고객/회사명" className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong" />
            </FormField>
            <FormField label="회사" error={errors.company?.message}>
              <input {...register('company')} placeholder="회사명 (선택)" className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong" />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="이메일" error={errors.email?.message}>
                <input {...register('email')} type="email" placeholder="이메일 (선택)" className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong" />
              </FormField>
              <FormField label="전화" error={errors.phone?.message}>
                <input {...register('phone')} placeholder="전화번호 (선택)" className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong" />
              </FormField>
            </div>
            <FormField label="계약 등급">
              <Select value={tier || 'none'} onValueChange={(v) => setValue('contract_tier', v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="등급 선택 (선택)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">없음</SelectItem>
                  <SelectItem value="bronze">Bronze</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                  <SelectItem value="gold">Gold</SelectItem>
                  <SelectItem value="platinum">Platinum</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>취소</Button>
          <Button onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>생성</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// 고객 목록 페이지 — 2-pane 트리뷰
// -----------------------------------------------------------------------
export default function CustomersPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data: treeData, isLoading } = useQuery<CustomerTreeNode[]>({
    queryKey: ['customers-tree', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/customers/tree`).then((r) => r.data),
    enabled: !!tenantSlug,
    staleTime: 30_000,
  });

  const tree = treeData ?? [];

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── 왼쪽 트리 패널 ─── */}
      <div className="w-72 shrink-0 flex flex-col h-full border-r border-white/10" style={{ background: 'var(--sidebar-bg)' }}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-white/10 shrink-0">
          <span className="text-sm font-medium text-white/80">고객</span>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <Plus size={12} />
            추가
          </button>
        </div>

        {/* 검색 */}
        <div className="px-3 py-2 border-b border-white/10 shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="고객 검색..."
              className="h-7 w-full pl-7 pr-3 rounded-md bg-white/[0.06] border border-white/10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
          </div>
        </div>

        {/* 트리 */}
        <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
          {isLoading ? (
            <div className="space-y-1 px-2 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-7 rounded-md bg-white/[0.04]" style={{ width: `${70 + Math.random() * 20}%` }} />
              ))}
            </div>
          ) : tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-4">
              <Users size={24} className="text-white/20" />
              <p className="text-xs text-white/40">고객이 없습니다.</p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="text-xs text-[#129B8E] hover:underline mt-1"
              >
                첫 고객 추가 →
              </button>
            </div>
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                selectedId={selectedId}
                onSelect={handleSelect}
                depth={0}
                searchQ={search}
              />
            ))
          )}
        </div>
      </div>

      {/* ─── 오른쪽 상세 패널 ─── */}
      <div className="flex-1 min-w-0 bg-bg overflow-hidden">
        {selectedId ? (
          <CustomerPanel tenantSlug={tenantSlug} customerId={selectedId} />
        ) : (
          <EmptySelection />
        )}
      </div>

      {/* 생성 모달 */}
      <CreateCustomerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
