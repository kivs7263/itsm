'use client';

/**
 * portal/[tenantSlug]/catalog/[code]/page.tsx — Offering 상세 + 동적 폼
 *
 * - GET /portal/{tenantSlug}/catalog/{code} → offering 정보 + form_schema
 * - 제목 입력 + DynamicForm 렌더
 * - POST /portal/{tenantSlug}/tickets body {offering_code, title, form_data, priority?}
 * - 성공: /portal/{tenantSlug}/tickets/{id} 이동
 * - 422: detail.errors[].{field, message} 필드별 표시
 * - 401 → login 리다이렉트
 */

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, AlertCircle, LayoutGrid } from 'lucide-react';
import api from '@/lib/api';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  DynamicForm,
  validateFields,
  type FormSchema,
  type FormValues,
} from '@/components/catalog/DynamicForm';
import type { TicketPriority } from '@/lib/types';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------
interface OfferingDetail {
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  request_type: string | null;
  default_priority: TicketPriority | null;
  form_schema: FormSchema;
}

interface CreatedTicket {
  id: string;
}

/** 백엔드 422 {detail: {message, errors: [{field, message}]}} */
interface CatalogValidationError {
  detail?: {
    message?: string;
    errors?: { field: string; message: string }[];
  };
}

// -----------------------------------------------------------------------
// 스켈레톤
// -----------------------------------------------------------------------
function OfferingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="bg-surface rounded-xl border border-border-default p-6 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function PortalCatalogCodePage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;
  const code = params?.code as string;

  // 모든 hook은 조건부 return 이전에 선언
  const { user, isLoading: authLoading } = usePortalAuth(tenantSlug);

  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState('');
  const [formValues, setFormValues] = useState<FormValues>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [serverGlobalError, setServerGlobalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    data: offering,
    isLoading: offeringLoading,
    isError,
  } = useQuery<OfferingDetail>({
    queryKey: ['portal-catalog-offering', tenantSlug, code],
    queryFn: async () => {
      const res = await api.get<OfferingDetail>(
        `/portal/${tenantSlug}/catalog/${code}`,
      );
      return res.data;
    },
    enabled: !!user && !!tenantSlug && !!code,
    staleTime: 2 * 60 * 1000,
  });

  // 인증 로딩 중
  if (authLoading) {
    return <OfferingSkeleton />;
  }

  // 미인증 → login 리다이렉트
  if (!user) {
    if (typeof window !== 'undefined') {
      router.replace(`/portal/${tenantSlug}/login`);
    }
    return <OfferingSkeleton />;
  }

  // offering 로딩 중
  if (offeringLoading) {
    return <OfferingSkeleton />;
  }

  // 에러 (404 포함)
  if (isError || !offering) {
    return (
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={() => router.push(`/portal/${tenantSlug}/catalog`)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={14} />
          서비스 카탈로그로 돌아가기
        </button>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
            <AlertCircle size={22} className="text-text-secondary" />
          </div>
          <p className="text-sm text-text-secondary">
            서비스 정보를 불러오지 못했습니다.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/portal/${tenantSlug}/catalog`)}
          >
            목록으로
          </Button>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // 제출 핸들러
  // -----------------------------------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 제목 검증
    if (!title.trim()) {
      setTitleError('제목을 입력해주세요');
      return;
    }
    setTitleError('');

    // 동적 필드 클라이언트 검증
    const fieldErrors = validateFields(
      offering.form_schema?.fields ?? [],
      formValues,
    );
    setClientErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setServerErrors({});
    setServerGlobalError('');
    setIsSubmitting(true);

    try {
      const body: {
        offering_code: string;
        title: string;
        form_data: FormValues;
        priority?: TicketPriority;
      } = {
        offering_code: offering.code,
        title: title.trim(),
        form_data: formValues,
      };
      if (offering.default_priority) {
        body.priority = offering.default_priority;
      }

      const res = await api.post<CreatedTicket>(
        `/portal/${tenantSlug}/tickets`,
        body,
      );
      router.push(`/portal/${tenantSlug}/tickets/${res.data.id}`);
    } catch (err: unknown) {
      // 422 필드별 에러 파싱
      if (
        err &&
        typeof err === 'object' &&
        'response' in err &&
        (err as { response?: { status?: number; data?: unknown } }).response
          ?.status === 422
      ) {
        const data = (
          err as { response: { data: CatalogValidationError } }
        ).response.data;

        if (data?.detail?.errors) {
          const fieldMap: Record<string, string> = {};
          for (const fe of data.detail.errors) {
            fieldMap[fe.field] = fe.message;
          }
          setServerErrors(fieldMap);
          // title 에러 처리
          if (fieldMap['title']) {
            setTitleError(fieldMap['title']);
          }
        }
        if (data?.detail?.message) {
          setServerGlobalError(data.detail.message);
        } else {
          setServerGlobalError('입력값을 확인해주세요.');
        }
      } else {
        setServerGlobalError(
          '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const fields = offering.form_schema?.fields ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* 뒤로가기 */}
      <button
        type="button"
        onClick={() => router.push(`/portal/${tenantSlug}/catalog`)}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors self-start"
      >
        <ArrowLeft size={14} />
        서비스 카탈로그
      </button>

      {/* Offering 헤더 */}
      <div className="flex items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ background: 'rgba(18, 155, 142, 0.10)' }}
        >
          {offering.icon ? (
            <span role="img" aria-label={offering.name}>{offering.icon}</span>
          ) : (
            <LayoutGrid size={22} style={{ color: '#129B8E' }} />
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{offering.name}</h1>
          {offering.description && (
            <p className="mt-1 text-sm text-text-secondary">{offering.description}</p>
          )}
        </div>
      </div>

      {/* 폼 */}
      <div className="bg-surface rounded-xl border border-border-default p-4 sm:p-6">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
          {/* 글로벌 에러 */}
          {serverGlobalError && (
            <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error/5 px-4 py-3">
              <AlertCircle size={14} className="shrink-0 text-error" />
              <p className="text-sm text-error-text">{serverGlobalError}</p>
            </div>
          )}

          {/* 제목 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="offering-title"
              className="text-sm font-medium text-text-primary"
            >
              요청 제목 <span className="text-error">*</span>
            </label>
            <input
              id="offering-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError('');
              }}
              placeholder="요청 내용을 간략하게 설명해주세요"
              disabled={isSubmitting}
              className={cn(
                'h-10 w-full rounded-md border px-3 text-sm',
                'bg-surface text-text-primary placeholder:text-text-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent-500',
                'transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed',
                titleError
                  ? 'border-error focus:ring-error'
                  : 'border-border-default',
              )}
            />
            {titleError && (
              <p className="text-xs text-error-text">{titleError}</p>
            )}
          </div>

          {/* 동적 필드 */}
          {fields.length > 0 && (
            <DynamicForm
              fields={fields}
              value={formValues}
              onChange={setFormValues}
              clientErrors={clientErrors}
              serverErrors={serverErrors}
              disabled={isSubmitting}
            />
          )}

          {/* 버튼 */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/portal/${tenantSlug}/catalog`)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              요청 접수
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
