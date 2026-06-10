'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LifeBuoy } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const loginSchema = z.object({
  email: z
    .string()
    .min(1, '이메일을 입력해주세요')
    .email('올바른 이메일 형식이 아닙니다'),
  password: z
    .string()
    .min(1, '비밀번호를 입력해주세요')
    .min(8, '비밀번호는 8자 이상이어야 합니다'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login, isLoginPending } = useAuth();
  const params = useParams<{ tenantSlug?: string }>();
  const slug = params?.tenantSlug ?? '';
  const [showPassword, setShowPassword] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      await login(values);
    } catch (error) {
      setServerError(getErrorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 로고 + 제목 */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl shadow-md"
          style={{ background: '#F5C000' }}
        >
          <LifeBuoy size={24} className="text-[#1A1A1A]" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text-primary">ITSM 로그인</h1>
          <p className="mt-1 text-sm text-text-secondary">
            IT 서비스 관리 시스템
          </p>
        </div>
      </div>

      {/* 폼 카드 */}
      <div className="bg-surface rounded-xl border border-border-default shadow-sm p-6 flex flex-col gap-5">
        {serverError && (
          <div
            role="alert"
            className={cn(
              'rounded-md border-l-2 border-error p-3',
              'bg-error-bg text-error-text text-sm',
            )}
          >
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {/* 이메일 필드 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-text-primary">
              이메일
            </label>
            <input
              id="email"
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

          {/* 비밀번호 필드 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-text-primary">
              비밀번호
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="비밀번호 입력"
                className={cn(
                  'h-10 w-full rounded-md border px-3 pr-10 text-sm',
                  'bg-surface text-text-primary placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-accent-500',
                  'transition-colors duration-fast',
                  errors.password
                    ? 'border-error focus:ring-error'
                    : 'border-border-default',
                )}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors duration-fast focus-visible:outline-none"
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-error-text">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoginPending}
            className={cn(
              'h-10 w-full rounded-md text-sm font-semibold mt-1',
              'transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:shadow-brand',
              isLoginPending
                ? 'bg-accent-300 text-accent-on cursor-not-allowed'
                : 'bg-accent text-accent-on hover:bg-accent-hover active:bg-accent-active',
            )}
            style={{
              background: isLoginPending ? undefined : '#F5C000',
              color: '#1A1A1A',
            }}
          >
            {isLoginPending ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>

      {slug && (
        <p className="text-center text-xs text-text-secondary">
          조직:{' '}
          <span className="font-medium text-text-primary">{slug}</span>
        </p>
      )}
    </div>
  );
}
