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
const createTicketSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.').max(200, '200자 이하로 입력해주세요.'),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  channel: z.enum(['email', 'phone', 'portal', 'internal']),
  customer_name: z.string().optional(),
  assignee_name: z.string().optional(),
});

type CreateTicketValues = z.infer<typeof createTicketSchema>;

// -----------------------------------------------------------------------
// 인라인 폼 필드 래퍼
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
interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

export function CreateTicketModal({ open, onClose, tenantSlug }: CreateTicketModalProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateTicketValues>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      priority: 'medium',
      channel: 'portal',
    },
  });

  const priority = watch('priority');
  const channel = watch('channel');

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(values: CreateTicketValues) {
    try {
      await api.post(`/${tenantSlug}/tickets`, values);
      toast.success('티켓이 생성되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>새 티켓 생성</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-0">
          <div className="flex flex-col gap-4">
            {/* 제목 */}
            <FormField label="제목" required error={errors.title?.message}>
              <input
                {...register('title')}
                placeholder="티켓 제목을 입력하세요"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>

            {/* 설명 */}
            <FormField label="설명" error={errors.description?.message}>
              <textarea
                {...register('description')}
                rows={3}
                placeholder="문제 내용을 자세히 설명해주세요"
                className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>

            {/* 우선순위 + 채널 */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="우선순위" required error={errors.priority?.message}>
                <Select
                  value={priority}
                  onValueChange={(v) => setValue('priority', v as CreateTicketValues['priority'])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">낮음</SelectItem>
                    <SelectItem value="medium">보통</SelectItem>
                    <SelectItem value="high">높음</SelectItem>
                    <SelectItem value="critical">긴급</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="채널" required error={errors.channel?.message}>
                <Select
                  value={channel}
                  onValueChange={(v) => setValue('channel', v as CreateTicketValues['channel'])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">이메일</SelectItem>
                    <SelectItem value="phone">전화</SelectItem>
                    <SelectItem value="portal">포털</SelectItem>
                    <SelectItem value="internal">내부</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {/* 고객 + 담당자 */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="고객" error={errors.customer_name?.message}>
                <input
                  {...register('customer_name')}
                  placeholder="고객명 (선택)"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>

              <FormField label="담당자" error={errors.assignee_name?.message}>
                <input
                  {...register('assignee_name')}
                  placeholder="담당자 (선택)"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            onClick={handleSubmit(onSubmit)}
            isLoading={isSubmitting}
          >
            생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
