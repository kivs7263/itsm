'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Package } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Asset, AssetsResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// -----------------------------------------------------------------------
// 날짜 포맷 유틸
// -----------------------------------------------------------------------
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return dateStr;
  }
}

// -----------------------------------------------------------------------
// 스켈레톤 행
// -----------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
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
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(18, 155, 142, 0.12)' }}
          >
            <Package size={28} strokeWidth={1.5} style={{ color: '#129B8E' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-text-primary">자산 없음</p>
            <p className="mt-1 text-sm text-text-secondary">등록된 자산이 없습니다.</p>
          </div>
          <Button size="sm" onClick={onNew} leftIcon={<Plus size={14} />}>
            새 자산
          </Button>
        </div>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// 새 자산 모달 스키마
// -----------------------------------------------------------------------
const createAssetSchema = z.object({
  asset_tag:          z.string().optional(),
  model:              z.string().optional(),
  asset_type:         z.string().optional(),
  customer_id:        z.string().optional(),
  installed_at:       z.string().optional(),
  warranty_end: z.string().optional(),
});

type CreateAssetValues = z.infer<typeof createAssetSchema>;

// -----------------------------------------------------------------------
// 폼 필드 래퍼
// -----------------------------------------------------------------------
function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      {children}
      {error && <p className="text-xs text-error-text">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------
// 새 자산 모달
// -----------------------------------------------------------------------
function CreateAssetModal({
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
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateAssetValues>({
    resolver: zodResolver(createAssetSchema),
  });

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(values: CreateAssetValues) {
    try {
      await api.post(`/${tenantSlug}/assets`, {
        asset_tag:           values.asset_tag || null,
        model:               values.model || null,
        asset_type:          values.asset_type || null,
        customer_id:         values.customer_id || null,
        installed_at:        values.installed_at || null,
        warranty_end: values.warranty_end || null,
      });
      toast.success('자산이 생성되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['assets', tenantSlug] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 자산 추가</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-0">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="자산 태그" error={errors.asset_tag?.message}>
                <input
                  {...register('asset_tag')}
                  placeholder="AST-001"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
              <FormField label="유형" error={errors.asset_type?.message}>
                <input
                  {...register('asset_type')}
                  placeholder="노트북, 서버 등"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
            </div>
            <FormField label="모델" error={errors.model?.message}>
              <input
                {...register('model')}
                placeholder="모델명 (선택)"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="설치일" error={errors.installed_at?.message}>
                <input
                  {...register('installed_at')}
                  type="date"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
              <FormField label="보증 만료일" error={errors.warranty_end?.message}>
                <input
                  {...register('warranty_end')}
                  type="date"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
            </div>
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
// 자산 목록 페이지
// -----------------------------------------------------------------------
export default function AssetsPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery<AssetsResponse | Asset[]>({
    queryKey: ['assets', tenantSlug, search],
    queryFn: () =>
      api.get(`/${tenantSlug}/assets`, {
        params: search ? { search } : undefined,
      }).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const assets: Asset[] = Array.isArray(data)
    ? data
    : Array.isArray((data as AssetsResponse)?.items)
      ? (data as AssetsResponse).items
      : [];

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">자산</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)} leftIcon={<Plus size={14} />}>
          새 자산
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
            placeholder="자산 검색..."
            className="h-8 pl-8 pr-3 w-56 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">자산 태그</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">모델</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">유형</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">고객</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">설치일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">보증 만료</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : assets.length === 0 ? (
              <EmptyState onNew={() => setCreateOpen(true)} />
            ) : (
              assets.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-border-subtle hover:bg-surface-hover transition-colors cursor-pointer"
                  onClick={() => router.push(`/${tenantSlug}/assets/${a.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-text-primary">
                    {typeof a.asset_tag === 'string' ? a.asset_tag : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    {typeof a.model === 'string' ? a.model : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {typeof a.asset_type === 'string' ? a.asset_type : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-sm">
                    {typeof a.customer_name === 'string' ? a.customer_name : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatDate(a.installed_at)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatDate(a.warranty_end)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 생성 모달 */}
      <CreateAssetModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
