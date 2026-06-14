'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Customer, CustomersResponse, ContractTier } from '@/lib/types';
import { cn } from '@/lib/utils';
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
  bronze:   'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  silver:   'bg-neutral-100 text-neutral-600',
  gold:     'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400',
  platinum: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
};

const TIER_LABELS: Record<ContractTier, string> = {
  bronze:   'Bronze',
  silver:   'Silver',
  gold:     'Gold',
  platinum: 'Platinum',
};

function TierBadge({ tier }: { tier: ContractTier | null }) {
  if (!tier) return <span className="text-xs text-text-disabled">-</span>;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TIER_STYLES[tier])}>
      {TIER_LABELS[tier]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 스켈레톤 행
// -----------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-36" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
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
      <td colSpan={5}>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(245, 192, 0, 0.12)' }}
          >
            <Users size={28} strokeWidth={1.5} style={{ color: '#F5C000' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">고객 없음</p>
            <p className="mt-1 text-sm text-text-secondary">등록된 고객이 없습니다.</p>
          </div>
          <Button size="sm" onClick={onNew} leftIcon={<Plus size={14} />}>
            새 고객
          </Button>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 새 고객 모달 Zod 스키마
// -----------------------------------------------------------------------
const createCustomerSchema = z.object({
  name:          z.string().min(1, '이름을 입력해주세요.'),
  company:       z.string().optional(),
  email:         z.string().email('올바른 이메일을 입력해주세요.').optional().or(z.literal('')),
  phone:         z.string().optional(),
  contract_tier: z.string().optional(),
});

type CreateCustomerValues = z.infer<typeof createCustomerSchema>;

// -----------------------------------------------------------------------
// 폼 필드 래퍼
// -----------------------------------------------------------------------
function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-error-text">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------
// 새 고객 모달
// -----------------------------------------------------------------------
function CreateCustomerModal({
  open,
  onClose,
  tenantSlug,
}: {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCustomerValues>({
    resolver: zodResolver(createCustomerSchema),
  });

  const tier = watch('contract_tier');

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(values: CreateCustomerValues) {
    try {
      await api.post(`/${tenantSlug}/customers`, {
        name:          values.name,
        company:       values.company || null,
        email:         values.email || null,
        phone:         values.phone || null,
        contract_tier: values.contract_tier || null,
      });
      toast.success('고객이 생성되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['customers', tenantSlug] });
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
              <input
                {...register('name')}
                placeholder="고객 이름"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
            <FormField label="회사" error={errors.company?.message}>
              <input
                {...register('company')}
                placeholder="회사명 (선택)"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="이메일" error={errors.email?.message}>
                <input
                  {...register('email')}
                  type="email"
                  placeholder="이메일 (선택)"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
              <FormField label="전화" error={errors.phone?.message}>
                <input
                  {...register('phone')}
                  placeholder="전화번호 (선택)"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
            </div>
            <FormField label="계약 등급" error={errors.contract_tier?.message}>
              <Select
                value={tier || 'none'}
                onValueChange={(v) => setValue('contract_tier', v === 'none' ? '' : v)}
              >
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
// 고객 목록 페이지
// -----------------------------------------------------------------------
export default function CustomersPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery<CustomersResponse | Customer[]>({
    queryKey: ['customers', tenantSlug, search],
    queryFn: () =>
      api.get(`/${tenantSlug}/customers`, {
        params: search ? { search } : undefined,
      }).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const customers: Customer[] = Array.isArray(data)
    ? data
    : Array.isArray((data as CustomersResponse)?.items)
      ? (data as CustomersResponse).items
      : [];

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">고객</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)} leftIcon={<Plus size={14} />}>
          새 고객
        </Button>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="고객 검색..."
            className="h-8 pl-8 pr-3 w-56 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이름</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">회사</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이메일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">전화</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">계약 등급</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : customers.length === 0 ? (
              <EmptyState onNew={() => setCreateOpen(true)} />
            ) : (
              customers.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border-subtle hover:bg-surface-hover transition-colors cursor-pointer"
                  onClick={() => router.push(`/${tenantSlug}/customers/${c.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    {typeof c.name === 'string' ? c.name : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-sm">
                    {typeof c.company === 'string' ? c.company : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-sm">
                    {typeof c.email === 'string' ? c.email : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-sm">
                    {typeof c.phone === 'string' ? c.phone : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge tier={c.contract_tier} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
