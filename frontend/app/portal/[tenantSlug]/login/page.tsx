'use client';

/**
 * 고객 포털 로그인 — 매직링크 발송 UI
 * API 연동 없이 UI만 구현 (Phase 2에서 연동 예정)
 *
 * 이메일 입력 → 제출 → "매직링크 발송됨" 안내 메시지 표시
 */

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const magicLinkSchema = z.object({
  email: z
    .string()
    .min(1, '이메일을 입력해주세요')
    .email('올바른 이메일 형식이 아닙니다'),
});

type MagicLinkFormValues = z.infer<typeof magicLinkSchema>;

export default function PortalLoginPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MagicLinkFormValues>({
    resolver: zodResolver(magicLinkSchema),
    mode: 'onBlur',
  });

  const onSubmit = async (values: MagicLinkFormValues) => {
    await api.post(`/portal/${tenantSlug}/auth/login`, { email: values.email });
    setSentEmail(values.email);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-6 text-center py-12">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: 'rgba(22, 163, 74, 0.10)' }}
        >
          <CheckCircle2 size={32} className="text-success" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">이메일을 확인해주세요</h2>
          <p className="mt-2 text-sm text-text-secondary">
            <strong className="text-text-primary">{sentEmail}</strong>으로
          </p>
          <p className="text-sm text-text-secondary">
            로그인 링크를 발송했습니다.
          </p>
          <p className="mt-3 text-xs text-text-secondary">
            이메일이 오지 않는다면 스팸함을 확인해주세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="text-sm text-text-secondary hover:text-text-primary underline transition-colors duration-fast"
        >
          다른 이메일로 시도
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 py-8">
      {/* 헤더 */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl shadow-sm"
          style={{ background: '#129B8E' }}
        >
          <Mail size={22} className="text-[#1A1A1A]" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text-primary">IT 지원 포털</h1>
          <p className="mt-1 text-sm text-text-secondary">
            이메일 주소를 입력하면 로그인 링크를 보내드립니다
          </p>
        </div>
      </div>

      {/* 폼 카드 */}
      <div className="bg-surface rounded-xl border border-border-default shadow-sm p-6">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="portal-email" className="text-sm font-medium text-text-primary">
              이메일 주소
            </label>
            <input
              id="portal-email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500',
                'transition-colors duration-fast',
                errors.email
                  ? 'border-error focus:ring-error'
                  : 'border-border-default',
              )}
              {...register('email')}
            />
            {errors.email && (
              <p className="text-xs text-error-text">{errors.email.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'h-10 w-full rounded-md text-sm font-semibold',
              'transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:shadow-brand',
              isSubmitting
                ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                : 'text-[#1A1A1A]',
            )}
            style={
              !isSubmitting
                ? { background: '#129B8E' }
                : undefined
            }
          >
            {isSubmitting ? '전송 중...' : '로그인 링크 받기'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-text-secondary">
        계정이 없다면 IT 담당자에게 문의해주세요.
      </p>
    </div>
  );
}
