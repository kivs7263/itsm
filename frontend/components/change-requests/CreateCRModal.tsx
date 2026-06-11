'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
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
// Zod 스키마
// -----------------------------------------------------------------------
const createCRSchema = z.object({
  title:               z.string().min(1, '제목을 입력해주세요.').max(500, '500자 이하로 입력해주세요.'),
  description:         z.string().optional(),
  change_type:         z.enum(['normal', 'emergency', 'standard']),
  risk_level:          z.enum(['low', 'medium', 'high', 'critical']),
  priority:            z.enum(['low', 'medium', 'high', 'critical']),
  rollback_plan:       z.string().optional(),
  implementation_plan: z.string().optional(),
});

type CreateCRValues = z.infer<typeof createCRSchema>;

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
// Props
// -----------------------------------------------------------------------
interface CreateCRModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

// -----------------------------------------------------------------------
// CreateCRModal
// -----------------------------------------------------------------------
export function CreateCRModal({ open, onClose, tenantSlug }: CreateCRModalProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCRValues>({
    resolver: zodResolver(createCRSchema),
    defaultValues: {
      change_type: 'normal',
      risk_level:  'medium',
      priority:    'medium',
    },
  });

  const changeType = watch('change_type');
  const riskLevel  = watch('risk_level');
  const priority   = watch('priority');

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(values: CreateCRValues) {
    try {
      const payload = {
        title:               values.title,
        description:         values.description || null,
        change_type:         values.change_type,
        risk_level:          values.risk_level,
        priority:            values.priority,
        rollback_plan:       values.rollback_plan || null,
        implementation_plan: values.implementation_plan || null,
      };
      await api.post(`/${tenantSlug}/change-requests`, payload);
      toast.success('변경 요청이 생성되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['change-requests', tenantSlug] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>새 변경 요청</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-0">
          <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-1">
            {/* 제목 */}
            <FormField label="제목" required error={errors.title?.message}>
              <input
                {...register('title')}
                placeholder="변경 요청 제목"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>

            {/* 유형 + 위험도 */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="변경 유형" required error={errors.change_type?.message}>
                <Select value={changeType} onValueChange={(v) => setValue('change_type', v as CreateCRValues['change_type'])}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">일반</SelectItem>
                    <SelectItem value="emergency">긴급</SelectItem>
                    <SelectItem value="standard">표준</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="위험도" required error={errors.risk_level?.message}>
                <Select value={riskLevel} onValueChange={(v) => setValue('risk_level', v as CreateCRValues['risk_level'])}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">긴급</SelectItem>
                    <SelectItem value="high">높음</SelectItem>
                    <SelectItem value="medium">보통</SelectItem>
                    <SelectItem value="low">낮음</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {/* 우선순위 */}
            <FormField label="우선순위" required error={errors.priority?.message}>
              <Select value={priority} onValueChange={(v) => setValue('priority', v as CreateCRValues['priority'])}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">긴급</SelectItem>
                  <SelectItem value="high">높음</SelectItem>
                  <SelectItem value="medium">보통</SelectItem>
                  <SelectItem value="low">낮음</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {/* 설명 */}
            <FormField label="설명" error={errors.description?.message}>
              <textarea
                {...register('description')}
                rows={3}
                placeholder="변경 내용 설명 (선택)"
                className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>

            {/* 구현 계획 */}
            <FormField label="구현 계획" error={errors.implementation_plan?.message}>
              <textarea
                {...register('implementation_plan')}
                rows={3}
                placeholder="구현 계획 (선택)"
                className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>

            {/* 롤백 계획 */}
            <FormField label="롤백 계획" error={errors.rollback_plan?.message}>
              <textarea
                {...register('rollback_plan')}
                rows={3}
                placeholder="롤백 계획 (선택)"
                className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
