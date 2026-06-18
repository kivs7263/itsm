'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LifeBuoy, CheckCircle2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import axios from 'axios';

const slugRegex = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

const signupSchema = z.object({
  company_name: z.string().min(2, '회사명은 2자 이상이어야 합니다').max(60),
  slug: z
    .string()
    .min(3, 'URL은 3~32자여야 합니다')
    .max(32)
    .regex(slugRegex, '영문 소문자·숫자·하이픈만 사용 가능합니다 (시작/끝은 영문·숫자)'),
  admin_email: z.string().email('올바른 이메일 형식이 아닙니다'),
  admin_name: z.string().min(1, '담당자 이름을 입력해주세요').max(60),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .regex(/[A-Z]/, '대문자가 하나 이상 포함되어야 합니다')
    .regex(/[0-9]/, '숫자가 하나 이상 포함되어야 합니다'),
});

type SignupFormValues = z.infer<typeof signupSchema>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '-')
    .replace(/[가-힣]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export default function SignupPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    mode: 'onBlur',
  });

  const watchCompanyName = watch('company_name', '');

  const handleCompanyNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const current = watch('slug');
    if (!current) {
      setValue('slug', slugify(name), { shouldValidate: true });
    }
  };

  const onSubmit = async (values: SignupFormValues) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      await axios.post('/api/auth/signup', values);
      setDone(values.slug);
    } catch (error) {
      setServerError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-xl shadow-lg"
            style={{ background: '#F5C000' }}
          >
            <CheckCircle2 size={28} className="text-[#1A1A1A]" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-text-primary">가입 완료!</h1>
            <p className="mt-2 text-sm text-text-secondary">
              워크스페이스가 생성되었습니다. 로그인해 주세요.
            </p>
          </div>
          <div className="w-full rounded-xl border border-border-default bg-surface p-4 text-sm text-text-secondary">
            접속 주소:{' '}
            <span className="font-mono font-semibold text-text-primary">
              /{done}/login
            </span>
          </div>
          <button
            onClick={() => router.push(`/${done}/login`)}
            className="w-full h-10 rounded-md text-sm font-semibold"
            style={{ background: '#F5C000', color: '#1A1A1A' }}
          >
            로그인 하러 가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        {/* 로고 + 제목 */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl shadow-md"
            style={{ background: '#F5C000' }}
          >
            <LifeBuoy size={24} className="text-[#1A1A1A]" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-text-primary">ITSM 시작하기</h1>
            <p className="mt-1 text-sm text-text-secondary">
              무료로 시작하세요. 신용카드 불필요.
            </p>
          </div>
        </div>

        {/* 폼 카드 */}
        <div className="bg-surface rounded-xl border border-border-default shadow-sm p-6 flex flex-col gap-5">
          {serverError && (
            <div
              role="alert"
              className="rounded-md border-l-2 border-error p-3 bg-error-bg text-error-text text-sm"
            >
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {/* 회사명 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="company_name" className="text-sm font-medium text-text-primary">
                회사명
              </label>
              <input
                id="company_name"
                type="text"
                placeholder="예) 하이브워크"
                className={cn(
                  'h-10 w-full rounded-md border px-3 text-sm bg-surface text-text-primary placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                  errors.company_name ? 'border-error' : 'border-border-default',
                )}
                {...register('company_name', { onBlur: handleCompanyNameBlur })}
              />
              {errors.company_name && (
                <p className="text-xs text-error-text">{errors.company_name.message}</p>
              )}
            </div>

            {/* 워크스페이스 URL */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="slug" className="text-sm font-medium text-text-primary">
                워크스페이스 URL
              </label>
              <div className="flex items-center h-10 rounded-md border border-border-default bg-surface overflow-hidden focus-within:ring-2 focus-within:ring-accent-500">
                <span className="pl-3 text-sm text-text-tertiary shrink-0 select-none">
                  itsm.io/
                </span>
                <input
                  id="slug"
                  type="text"
                  placeholder="my-company"
                  className={cn(
                    'flex-1 h-full pr-3 text-sm bg-transparent text-text-primary placeholder:text-text-disabled',
                    'focus:outline-none',
                    errors.slug ? 'border-error' : '',
                  )}
                  {...register('slug')}
                />
              </div>
              {errors.slug && (
                <p className="text-xs text-error-text">{errors.slug.message}</p>
              )}
            </div>

            {/* 담당자 이름 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin_name" className="text-sm font-medium text-text-primary">
                담당자 이름
              </label>
              <input
                id="admin_name"
                type="text"
                placeholder="홍길동"
                className={cn(
                  'h-10 w-full rounded-md border px-3 text-sm bg-surface text-text-primary placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                  errors.admin_name ? 'border-error' : 'border-border-default',
                )}
                {...register('admin_name')}
              />
              {errors.admin_name && (
                <p className="text-xs text-error-text">{errors.admin_name.message}</p>
              )}
            </div>

            {/* 이메일 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin_email" className="text-sm font-medium text-text-primary">
                업무 이메일
              </label>
              <input
                id="admin_email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                className={cn(
                  'h-10 w-full rounded-md border px-3 text-sm bg-surface text-text-primary placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                  errors.admin_email ? 'border-error' : 'border-border-default',
                )}
                {...register('admin_email')}
              />
              {errors.admin_email && (
                <p className="text-xs text-error-text">{errors.admin_email.message}</p>
              )}
            </div>

            {/* 비밀번호 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-text-primary">
                비밀번호
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="8자 이상, 대문자·숫자 포함"
                  className={cn(
                    'h-10 w-full rounded-md border px-3 pr-10 text-sm bg-surface text-text-primary placeholder:text-text-disabled',
                    'focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-fast',
                    errors.password ? 'border-error' : 'border-border-default',
                  )}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
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
              disabled={isSubmitting}
              className={cn(
                'h-10 w-full rounded-md text-sm font-semibold mt-1 transition-colors duration-fast focus-visible:outline-none',
                isSubmitting ? 'opacity-60 cursor-not-allowed' : '',
              )}
              style={{ background: '#F5C000', color: '#1A1A1A' }}
            >
              {isSubmitting ? '워크스페이스 생성 중...' : '무료로 시작하기'}
            </button>
          </form>

          <p className="text-center text-xs text-text-secondary">
            이미 계정이 있으신가요?{' '}
            <a href="/" className="font-medium text-text-primary hover:underline">
              로그인
            </a>
          </p>
        </div>

        {/* 플랜 요약 */}
        <div className="rounded-xl border border-border-subtle bg-surface-elevated px-5 py-4">
          <p className="text-xs font-semibold text-text-secondary mb-2">Free 플랜 포함:</p>
          <ul className="flex flex-col gap-1">
            {[
              '엔지니어 3명',
              '월 100건 티켓',
              'KB · SLA · 고객 포털',
              '이메일 지원',
            ].map((f) => (
              <li key={f} className="flex items-center gap-2 text-xs text-text-secondary">
                <CheckCircle2 size={12} className="text-success shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
