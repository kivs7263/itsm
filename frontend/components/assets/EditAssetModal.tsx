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
  ASSET_TYPE_LABELS,
  ASSET_CATEGORY_OPTIONS_BY_TYPE,
  assetCategoryLabel,
  getAssetCategory,
  type AssetTypeCode,
} from '@/lib/assetTypes';
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
import { Button } from '@/components/ui/button';

// -----------------------------------------------------------------------
// Zod 스키마
// -----------------------------------------------------------------------
const editAssetSchema = z.object({
  asset_tag:    z.string().optional(),
  model:        z.string().optional(),
  serial:       z.string().optional(),
  // RX-1e: 백엔드 DB enum(hw/sw)만 허용 — 자유 텍스트 입력은 422 오류를 유발했음
  asset_type:   z.enum(['hw', 'sw']),
  category:     z.string().optional(),
  status:       z.enum(['active', 'retired', 'disposed']),
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

  // DB enum(hw/sw)만 허용 — 방어적으로 미확인 값은 'hw'로 폴백
  function toAssetType(v: string | null | undefined): AssetTypeCode {
    return v === 'sw' ? 'sw' : 'hw';
  }

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EditAssetValues>({
    resolver: zodResolver(editAssetSchema),
    defaultValues: {
      asset_tag:    asset.asset_tag,
      model:        asset.model,
      serial:       asset.serial ?? '',
      asset_type:   toAssetType(asset.asset_type),
      category:     getAssetCategory(asset.location),
      status:       (['active', 'retired', 'disposed'].includes(asset.status) ? asset.status : 'active') as 'active' | 'retired' | 'disposed',
      installed_at: toDateInput(asset.installed_at),
      warranty_end: toDateInput(asset.warranty_end),
      license_end:  toDateInput(asset.license_end),
    },
  });

  const assetTypeValue = watch('asset_type');
  const categoryValue = watch('category');
  const statusValue = watch('status');

  // 모달 열릴 때마다 최신 asset 값으로 폼 초기화
  useEffect(() => {
    if (open) {
      reset({
        asset_tag:    asset.asset_tag,
        model:        asset.model,
        serial:       asset.serial ?? '',
        asset_type:   toAssetType(asset.asset_type),
        category:     getAssetCategory(asset.location),
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
        asset_type:   values.asset_type,
        status:       values.status,
        // RX-1e: 세부 유형은 검증 없는 location(JSONB)에 저장 (백엔드 asset_type enum은 hw/sw만 허용)
        location:     { ...(asset.location ?? {}), category: values.category || undefined },
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
                <Select
                  value={assetTypeValue}
                  onValueChange={(v) => {
                    setValue('asset_type', v as AssetTypeCode, { shouldValidate: true });
                    // 대분류 변경 시 다른 대분류의 세부값 잔존 방지
                    setValue('category', '', { shouldValidate: false });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(ASSET_TYPE_LABELS) as [AssetTypeCode, string][]).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField label="세부 유형" error={errors.category?.message}>
              <Select
                value={categoryValue ?? ''}
                onValueChange={(v) => setValue('category', v, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택 (선택사항)" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CATEGORY_OPTIONS_BY_TYPE[assetTypeValue].map((c) => (
                    <SelectItem key={c} value={c}>{assetCategoryLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="상태" error={errors.status?.message}>
              <Select
                value={statusValue}
                onValueChange={(v) => setValue('status', v as 'active' | 'retired' | 'disposed', { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">사용 중</SelectItem>
                  <SelectItem value="retired">사용 중지</SelectItem>
                  <SelectItem value="disposed">폐기</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
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
