'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LifeBuoy } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const registerSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요'),
  email: z.string().min(1, '이메일을 입력해주세요').email('올바른 이메일 형식이 아닙니다'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다'),
  confirmPassword: z.string().min(1, '비밀번호를 다시 입력해주세요'),
  organization_name: z.string().min(1, '조직명을 입력해주세요'),
  slug: z
    .string()
    .min(2, '슬러그는 2자 이상이어야 합니다')
    .regex(/^[a-z0-9-]+$/, '소문자, 숫자, 하이픈(-)만 사용 가능합니다'),
}).refine((d) => d.password === d.confirmPassword, {
  message: '비밀번호가 일치하지 않습니다',
  path: ['confirmPassword'],
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const params = useParams<{ tenantSlug?: string }>();
  const slug = params?.tenantSlug ?? '';
  const router = useRouter();
  const [showPassword, setShowPassword] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onBlur',
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      await api.post('/auth/register', {
        name: values.name,
        email: values.email,
        password: values.password,
        organization_name: values.organization_name,
        slug: values.slug,
      });
      router.replace(`/${values.slug}/tickets`);
    } catch (error) {
      setServerError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 로고 + 제목 */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl shadow-md"
          style={{ background: '#129B8E' }}
        >
          <LifeBuoy size={24} className="text-[#1A1A1A]" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text-primary">ITSM 회원가입</h1>
          <p className="mt-1 text-sm text-text-secondary">새 조직과 관리자 계정을 만듭니다</p>
        </div>
      </div>

      {/* 폼 카드 */}
      <div className="bg-surface rounded-xl border border-border-default shadow-sm p-6 flex flex-col gap-5">
        {serverError && (
          <div
            role="alert"
            className={cn('rounded-md border-l-2 border-error p-3', 'bg-error-bg text-error-text text-sm')}
          >
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {/* 이름 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium text-text-primary">이름</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="홍길동"
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                errors.name ? 'border-error focus:ring-error' : 'border-border-default',
              )}
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-error-text">{errors.name.message}</p>}
          </div>

          {/* 이메일 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-text-primary">이메일</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                errors.email ? 'border-error focus:ring-error' : 'border-border-default',
              )}
              {...register('email')}
            />
            {errors.email && <p className="text-xs text-error-text">{errors.email.message}</p>}
          </div>

          {/* 비밀번호 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-text-primary">비밀번호</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="8자 이상"
                className={cn(
                  'h-10 w-full rounded-md border px-3 pr-10 text-sm',
                  'bg-surface text-text-primary placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                  errors.password ? 'border-error focus:ring-error' : 'border-border-default',
                )}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors duration-fast focus-visible:outline-none"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-error-text">{errors.password.message}</p>}
          </div>

          {/* 비밀번호 확인 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirmPassword" className="text-sm font-medium text-text-primary">비밀번호 확인</label>
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="비밀번호 재입력"
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                errors.confirmPassword ? 'border-error focus:ring-error' : 'border-border-default',
              )}
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && <p className="text-xs text-error-text">{errors.confirmPassword.message}</p>}
          </div>

          <div className="h-px bg-border-default" />

          {/* 조직명 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="organization_name" className="text-sm font-medium text-text-primary">조직명</label>
            <input
              id="organization_name"
              type="text"
              placeholder="Acme Inc."
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                errors.organization_name ? 'border-error focus:ring-error' : 'border-border-default',
              )}
              {...register('organization_name')}
            />
            {errors.organization_name && <p className="text-xs text-error-text">{errors.organization_name.message}</p>}
          </div>

          {/* 슬러그 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="slug" className="text-sm font-medium text-text-primary">
              조직 슬러그
              <span className="ml-1 text-xs font-normal text-text-secondary">(URL에 사용되는 고유 식별자)</span>
            </label>
            <input
              id="slug"
              type="text"
              placeholder="acme (소문자, 숫자, 하이픈)"
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                errors.slug ? 'border-error focus:ring-error' : 'border-border-default',
              )}
              {...register('slug')}
            />
            {errors.slug && <p className="text-xs text-error-text">{errors.slug.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'h-10 w-full rounded-md text-sm font-semibold mt-1',
              'transition-colors duration-fast focus-visible:outline-none',
              isSubmitting ? 'cursor-not-allowed opacity-60' : '',
            )}
            style={{ background: '#129B8E', color: '#1A1A1A' }}
          >
            {isSubmitting ? '처리 중...' : '회원가입'}
          </button>
        </form>

        <p className="text-center text-xs text-text-secondary">
          이미 계정이 있으신가요?{' '}
          <a href={`/${slug}/login`} className="font-medium text-text-primary hover:underline">
            로그인
          </a>
        </p>
      </div>
    </div>
  );
}
