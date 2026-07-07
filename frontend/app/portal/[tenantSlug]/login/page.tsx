'use client';

/**
 * 고객 포털 로그인 — 매직링크 발송 UI
 *
 * 이메일 입력 → 제출 → POST /portal/{slug}/auth/login (202 Accepted, 항상 동일 응답 —
 * 보안상 계정 존재 여부를 노출하지 않음. 백엔드 실 발송 성패와 무관하게 202를 반환하므로
 * "발송 완료"가 아니라 "요청 접수" 시맨틱으로 안내한다 (IPA-3, 2026-07-07).
 *
 * IPA-3: 스팸함 확인 안내 + 재전송(쿨다운) + 미도착 시 상담원 문의 대체채널 안내.
 * ⚠️ 재전송도 동일 /auth/login 엔드포인트를 재호출 — 별도 resend 엔드포인트는 없음
 *    (app/routers/portal_customer.py 확인, 202 응답 자체가 재전송 겸용).
 * ⚠️ 실제 API 호출이 실패(네트워크/5xx)한 경우에만 에러로 표시 — 백엔드가 202를 준 뒤에는
 *    실제 메일함 도달 여부를 프론트가 알 수 없으므로 "성공"을 단정하지 않고 접수 문구만 노출한다.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, CheckCircle2, RotateCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const magicLinkSchema = z.object({
  email: z
    .string()
    .min(1, '이메일을 입력해주세요')
    .email('올바른 이메일 형식이 아닙니다'),
});

type MagicLinkFormValues = z.infer<typeof magicLinkSchema>;

// 재전송 쿨다운(초) — 서버에 별도 rate-limit이 없어(portal_customer.py 확인)
// 클라이언트에서 연타를 방지한다.
const RESEND_COOLDOWN_SECONDS = 60;

export default function PortalLoginPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [remember, setRemember] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [resendPending, setResendPending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MagicLinkFormValues>({
    resolver: zodResolver(magicLinkSchema),
    mode: 'onBlur',
  });

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const onSubmit = async (values: MagicLinkFormValues) => {
    setSubmitError(null);
    try {
      await api.post(`/portal/${tenantSlug}/auth/login`, { email: values.email, remember });
      setSentEmail(values.email);
      setSent(true);
      setResendError(null);
      startCooldown();
    } catch {
      // 요청 자체가 실패(네트워크/5xx)한 경우에만 에러 — 거짓 성공 방지
      setSubmitError('요청 전송에 실패했습니다. 잠시 후 다시 시도하거나 상담원에게 문의해주세요.');
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resendPending || !sentEmail) return;
    setResendPending(true);
    setResendError(null);
    try {
      await api.post(`/portal/${tenantSlug}/auth/login`, { email: sentEmail, remember });
      startCooldown();
    } catch {
      // 실제 요청 자체가 실패한 경우에만 에러 표시 — 거짓 성공 방지
      setResendError('재전송 요청에 실패했습니다. 잠시 후 다시 시도하거나 상담원에게 문의해주세요.');
    } finally {
      setResendPending(false);
    }
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
            <strong className="text-text-primary">{sentEmail}</strong>(으)로
          </p>
          <p className="text-sm text-text-secondary">
            로그인 링크 요청이 접수되었습니다. 몇 분 내로 도착합니다.
          </p>
          <p className="mt-3 text-xs text-text-secondary">
            이메일이 보이지 않는다면 <strong className="text-text-primary">스팸함</strong>도 확인해주세요.
          </p>
        </div>

        {/* 재전송 + 대체채널 안내 */}
        <div className="w-full max-w-xs rounded-lg border border-border-default bg-surface p-4 text-left">
          <p className="text-xs font-medium text-text-primary">이메일이 오지 않나요?</p>
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || resendPending}
            className={cn(
              'mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium',
              'transition-colors duration-fast',
              cooldown > 0 || resendPending
                ? 'border-border-default text-text-disabled cursor-not-allowed'
                : 'border-border-default text-text-primary hover:bg-surface-hover',
            )}
          >
            <RotateCw size={13} className={resendPending ? 'animate-spin' : undefined} />
            {resendPending
              ? '재전송 요청 중...'
              : cooldown > 0
                ? `${cooldown}초 후 재전송 가능`
                : '로그인 링크 다시 받기'}
          </button>
          {resendError && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-error-text">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {resendError}
            </p>
          )}
          <p className="mt-3 text-xs text-text-secondary">
            몇 분 내로 도착하지 않으면 IT 담당자(상담원)에게 문의해주세요.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSent(false);
            setResendError(null);
          }}
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

          {submitError && (
            <p className="flex items-start gap-1.5 text-xs text-error-text">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {submitError}
            </p>
          )}

          {/* IPA-2: '이 기기 기억' — 체크 시 장수명 세션(90일), 해제 시 기본(30일).
              매직링크가 유일 접근경로라 기본을 체크(true)로 둬 재락아웃을 줄인다. */}
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-border-default text-[#129B8E] focus:ring-2 focus:ring-accent-500"
            />
            이 기기 기억하기 <span className="text-text-disabled">(공용 PC에서는 해제)</span>
          </label>

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
        계정이 없거나 이메일이 도착하지 않는다면 IT 담당자(상담원)에게 문의해주세요.
      </p>
    </div>
  );
}
