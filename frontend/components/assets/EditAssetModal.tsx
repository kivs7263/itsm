'use client';

import * as React from 'react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Asset } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// -----------------------------------------------------------------------
// Zod 스키마
// -----------------------------------------------------------------------
const editAssetSchema = z.object({
  asset_tag:    z.string().optional(),
  model:        z.string().optional(),
  serial:       z.string().optional(),
  asset_type:   z.string().optional(),
  installed_at: z.string().optional(),
  warranty_end: z.string().optional(),
  license_end:  z.string().optional(),
});

type EditAssetValues = z.infer<typeof editAssetSchema>;

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
// Props
// -----------------------------------------------------------------------
interface EditAssetModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  asset: Asset;
}

// -----------------------------------------------------------------------
// EditAssetModal — PATCH /{tenant}/assets/{id}
// -----------------------------------------------------------------------
export function EditAssetModal({ open, onClose, tenantSlug, asset }: EditAssetModalProps) {
  const queryClient = useQueryClient();

  // installed_at / warranty_end / license_end: ISO 날짜 → YYYY-MM-DD 변환 (input type=date)
  function toDateInput(val: string | null | undefined): string {
    if (!val) return '';
    try { return val.substring(0, 10); } catch { return ''; }
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditAssetValues>({
    resolver: zodResolver(editAssetSchema),
    defaultValues: {
      asset_tag:    asset.asset_tag,
      model:        asset.model,
      serial:       asset.serial ?? '',
      asset_type:   asset.asset_type,
      installed_at: toDateInput(asset.installed_at),
      warranty_end: toDateInput(asset.warranty_end),
      license_end:  toDateInput(asset.license_end),
    },
  });

  // 모달 열릴 때마다 최신 asset 값으로 폼 초기화
  useEffect(() => {
    if (open) {
      reset({
        asset_tag:    asset.asset_tag,
        model:        asset.model,
        serial:       asset.serial ?? '',
        asset_type:   asset.asset_type,
        installed_at: toDateInput(asset.installed_at),
        warranty_end: toDateInput(asset.warranty_end),
        license_end:  toDateInput(asset.license_end),
      });
    }
  }, [open, asset, reset]);

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(values: EditAssetValues) {
    try {
      await api.patch(`/${tenantSlug}/assets/${asset.id}`, {
        asset_tag:    values.asset_tag    || null,
        model:        values.model        || null,
        serial:       values.serial       || null,
        asset_type:   values.asset_type   || null,
        installed_at: values.installed_at || null,
        warranty_end: values.warranty_end || null,
        license_end:  values.license_end  || null,
      });
      toast.success('자산이 수정되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['asset-detail', tenantSlug, asset.id] });
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
          <DialogTitle>자산 수정</DialogTitle>
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
                placeholder="모델명"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
            <FormField label="시리얼" error={errors.serial?.message}>
              <input
                {...register('serial')}
                placeholder="시리얼 번호 (선택)"
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
            <FormField label="라이선스 만료일" error={errors.license_end?.message}>
              <input
                {...register('license_end')}
                type="date"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
