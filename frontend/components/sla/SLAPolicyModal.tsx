'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { SlaPolicy } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// -----------------------------------------------------------------------
// 스키마
// -----------------------------------------------------------------------
const policySchema = z.object({
  grade: z.enum(['bronze', 'silver', 'gold', 'platinum']),
  response_minutes: z.number({ invalid_type_error: '숫자를 입력해주세요.' }).int().min(1, '1 이상이어야 합니다.'),
  resolution_minutes: z.number({ invalid_type_error: '숫자를 입력해주세요.' }).int().min(1, '1 이상이어야 합니다.'),
});
type PolicyValues = z.infer<typeof policySchema>;

const GRADE_LABELS: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

// -----------------------------------------------------------------------
// 폼 필드 래퍼
// -----------------------------------------------------------------------
function FormField({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-text-primary">
        {label}
        {required && <span className="ml-1 text-error-text">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-text-secondary">{hint}</p>}
      {error && <p className="text-xs text-error-text">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------
// 모달
// -----------------------------------------------------------------------
interface SLAPolicyModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  /** 편집 시 기존 정책 전달. null이면 신규 생성 */
  policy?: SlaPolicy | null;
}

export function SLAPolicyModal({ open, onClose, tenantSlug, policy }: SLAPolicyModalProps) {
  const isEdit = !!policy;
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PolicyValues>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      grade: 'bronze',
      response_minutes: 60,
      resolution_minutes: 480,
    },
  });

  const grade = watch('grade');

  // 편집 모드 초기값 세팅
  useEffect(() => {
    if (open && policy) {
      reset({
        grade: policy.grade,
        response_minutes: policy.response_minutes,
        resolution_minutes: policy.resolution_minutes,
      });
    } else if (open && !policy) {
      reset({ grade: 'bronze', response_minutes: 60, resolution_minutes: 480 });
    }
  }, [open, policy, reset]);

  async function onSubmit(values: PolicyValues) {
    try {
      if (isEdit && policy) {
        // PUT /policies/{policy_id}
        await api.put(`/${tenantSlug}/sla/policies/${policy.id}`, {
          response_minutes: values.response_minutes,
          resolution_minutes: values.resolution_minutes,
        });
        toast.success('SLA 정책이 수정되었습니다.');
      } else {
        // POST /policies (UPSERT)
        await api.post(`/${tenantSlug}/sla/policies`, values);
        toast.success('SLA 정책이 저장되었습니다.');
      }
      queryClient.invalidateQueries({ queryKey: ['sla-policies', tenantSlug] });
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'SLA 정책 수정' : 'SLA 정책 추가'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          {/* 등급 */}
          <FormField label="등급" required error={errors.grade?.message}>
            <Select
              value={grade}
              onValueChange={(v) => setValue('grade', v as PolicyValues['grade'])}
              disabled={isEdit} // 편집 시 등급 변경 불가 (ID 기반 수정)
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="등급 선택" />
              </SelectTrigger>
              <SelectContent>
                {(['bronze', 'silver', 'gold', 'platinum'] as const).map((g) => (
                  <SelectItem key={g} value={g}>{GRADE_LABELS[g]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* 응답 시간 */}
          <FormField
            label="응답 시간 (분)"
            required
            error={errors.response_minutes?.message}
            hint="예: 60 = 1시간, 240 = 4시간"
          >
            <input
              {...register('response_minutes', { valueAsNumber: true })}
              type="number"
              min={1}
              className="w-full h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
              placeholder="60"
            />
          </FormField>

          {/* 해결 시간 */}
          <FormField
            label="해결 시간 (분)"
            required
            error={errors.resolution_minutes?.message}
            hint="예: 480 = 8시간, 1440 = 1일"
          >
            <input
              {...register('resolution_minutes', { valueAsNumber: true })}
              type="number"
              min={1}
              className="w-full h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
              placeholder="480"
            />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? '저장' : '추가'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
