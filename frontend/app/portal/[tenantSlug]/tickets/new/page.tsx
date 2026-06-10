'use client';

/**
 * portal/[tenantSlug]/tickets/new/page.tsx — 새 티켓 접수
 *
 * react-hook-form + zod 검증
 * 제출: POST /api/portal/{tenantSlug}/tickets
 * 성공: sonner toast + /portal/{tenantSlug}/tickets 이동
 */

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { TicketPriority } from '@/lib/types';

// -----------------------------------------------------------------------
// Zod 스키마
// -----------------------------------------------------------------------
const newTicketSchema = z.object({
  title: z
    .string()
    .min(1, '제목을 입력해주세요')
    .max(500, '제목은 500자 이하여야 합니다'),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical'] as const, {
    required_error: '우선순위를 선택해주세요',
  }),
});

type NewTicketFormValues = z.infer<typeof newTicketSchema>;

interface CreateTicketPayload {
  title: string;
  description?: string;
  priority: TicketPriority;
  channel: 'portal';
}

interface CreatedTicket {
  id: string;
}

// -----------------------------------------------------------------------
// 로딩 스켈레톤
// -----------------------------------------------------------------------
function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <div className="bg-surface rounded-xl border border-border-default p-6 flex flex-col gap-4">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function PortalNewTicketPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;

  // 모든 hook은 조건부 return 이전에 선언
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<NewTicketFormValues>({
    resolver: zodResolver(newTicketSchema),
    defaultValues: {
      title: '',
      description: '',
      priority: 'medium',
    },
    mode: 'onBlur',
  });

  const createMutation = useMutation({
    mutationFn: async (values: NewTicketFormValues) => {
      const payload: CreateTicketPayload = {
        title: values.title,
        description: values.description || undefined,
        priority: values.priority,
        channel: 'portal',
      };
      const response = await api.post<CreatedTicket>(
        `/portal/${tenantSlug}/tickets`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      toast.success('티켓이 접수되었습니다');
      router.push(`/portal/${tenantSlug}/tickets`);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  // 인증 로딩 중
  if (authLoading) {
    return <FormSkeleton />;
  }

  // 미인증
  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return <FormSkeleton />;
  }

  const onSubmit = (values: NewTicketFormValues) => {
    createMutation.mutate(values);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-text-primary">새 티켓 접수</h1>

      <div className="bg-surface rounded-xl border border-border-default p-6">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          {/* 제목 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="ticket-title"
              className="text-sm font-medium text-text-primary"
            >
              제목 <span className="text-error">*</span>
            </label>
            <input
              id="ticket-title"
              type="text"
              placeholder="문제를 간략하게 설명해주세요"
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500',
                'transition-colors duration-fast',
                errors.title
                  ? 'border-error focus:ring-error'
                  : 'border-border-default',
              )}
              {...register('title')}
            />
            {errors.title && (
              <p className="text-xs text-error-text">{errors.title.message}</p>
            )}
          </div>

          {/* 설명 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="ticket-description"
              className="text-sm font-medium text-text-primary"
            >
              설명
            </label>
            <textarea
              id="ticket-description"
              rows={5}
              placeholder="문제 상황, 발생 시간, 영향 범위 등을 자세히 적어주세요 (선택사항)"
              className={cn(
                'w-full resize-none rounded-md border px-3 py-2.5 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500',
                'transition-colors duration-fast',
                errors.description
                  ? 'border-error focus:ring-error'
                  : 'border-border-default',
              )}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-error-text">
                {errors.description.message}
              </p>
            )}
          </div>

          {/* 우선순위 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">
              우선순위
            </label>
            <Controller
              name="priority"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className={errors.priority ? 'border-error' : undefined}
                  >
                    <SelectValue placeholder="우선순위 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">낮음</SelectItem>
                    <SelectItem value="medium">보통</SelectItem>
                    <SelectItem value="high">높음</SelectItem>
                    <SelectItem value="critical">긴급</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.priority && (
              <p className="text-xs text-error-text">
                {errors.priority.message}
              </p>
            )}
          </div>

          {/* 버튼 */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/portal/${tenantSlug}/tickets`)}
              disabled={createMutation.isPending}
            >
              취소
            </Button>
            <Button
              type="submit"
              isLoading={createMutation.isPending}
            >
              접수하기
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
