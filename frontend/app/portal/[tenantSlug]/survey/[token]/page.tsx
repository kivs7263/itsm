'use client';

/**
 * portal/[tenantSlug]/survey/[token]/page.tsx — 고객 CSAT 설문
 *
 * - 인증 없음: 토큰 기반 접근 (usePortalAuth 미사용)
 * - 5가지 상태: 로딩 / 만료됨(410) / 이미 제출됨 / 오류(404) / 설문 폼
 * - 별점 1~5 인터랙션 (hover + 클릭)
 * - 제출 완료 시 로컬 상태로 완료 화면 전환
 */

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

// -----------------------------------------------------------------------
// 타입
// -----------------------------------------------------------------------
interface SurveyData {
  id: string;
  ticket_id: string;
  ticket_title: string;
  score: number | null;
  comment: string | null;
  status: 'pending' | 'submitted' | 'expired';
  is_submitted: boolean;
  expires_at: string;
}

// -----------------------------------------------------------------------
// 점수 레이블
// -----------------------------------------------------------------------
const SCORE_LABELS: Record<number, string> = {
  1: '매우 불만족',
  2: '불만족',
  3: '보통',
  4: '만족',
  5: '매우 만족',
};

// -----------------------------------------------------------------------
// 스켈레톤 카드
// -----------------------------------------------------------------------
function SurveySkeleton() {
  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-surface rounded-2xl border border-border-default p-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2 justify-center">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-10 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 상태 카드 (만료 / 완료 / 오류)
// -----------------------------------------------------------------------
function StatusCard({
  icon,
  iconColor,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-surface rounded-2xl border border-border-default p-10 flex flex-col items-center gap-4 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: `${iconColor}1a` }}
        >
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-base font-semibold text-text-primary">{title}</p>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export default function SurveyPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const token = params?.token as string;
  const queryClient = useQueryClient();

  // 모든 hook 선언은 조건부 return 이전에
  const [score, setScore] = useState<number>(0);
  const [hovered, setHovered] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const {
    data: survey,
    isLoading,
    error: queryError,
  } = useQuery<SurveyData>({
    queryKey: ['portal-survey', token],
    queryFn: async () => {
      const res = await api.get<SurveyData>(
        `/portal/${tenantSlug}/survey/${token}`,
      );
      return res.data;
    },
    enabled: !!tenantSlug && !!token,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/portal/${tenantSlug}/survey/${token}`, {
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-survey', token] });
      setSubmitted(true);
    },
    onError: (err) => {
      setErrorMsg(getErrorMessage(err));
    },
  });

  // -----------------------------------------------------------------------
  // 상태별 렌더링
  // -----------------------------------------------------------------------

  if (isLoading) {
    return <SurveySkeleton />;
  }

  // 410 만료 또는 쿼리 에러 처리
  if (queryError) {
    const status =
      queryError &&
      typeof queryError === 'object' &&
      'response' in queryError
        ? (queryError as { response?: { status?: number } }).response?.status
        : undefined;

    if (status === 410) {
      return (
        <StatusCard
          icon={<Clock size={24} />}
          iconColor="#9ca3af"
          title="설문이 만료되었습니다"
          description="설문 응답 기간이 종료되었습니다."
        />
      );
    }

    if (status === 404) {
      return (
        <StatusCard
          icon={<AlertCircle size={24} />}
          iconColor="#ef4444"
          title="유효하지 않은 설문 링크입니다"
          description="링크가 올바른지 확인해주세요."
        />
      );
    }

    return (
      <StatusCard
        icon={<AlertCircle size={24} />}
        iconColor="#ef4444"
        title="오류가 발생했습니다"
        description="잠시 후 다시 시도해주세요."
      />
    );
  }

  // 이미 제출됨 (서버에서 is_submitted=true 또는 로컬 제출 완료)
  if (submitted || survey?.is_submitted) {
    return (
      <StatusCard
        icon={<CheckCircle size={24} />}
        iconColor="#22c55e"
        title={
          submitted
            ? '제출되었습니다. 소중한 의견 감사합니다.'
            : '이미 제출된 설문입니다'
        }
        description={
          submitted
            ? '소중한 피드백으로 더 나은 서비스를 만들겠습니다.'
            : '이미 설문에 응답해 주셨습니다. 감사합니다.'
        }
      />
    );
  }

  // status === 'expired' (is_submitted=false지만 만료)
  if (survey?.status === 'expired') {
    return (
      <StatusCard
        icon={<Clock size={24} />}
        iconColor="#9ca3af"
        title="설문이 만료되었습니다"
        description="설문 응답 기간이 종료되었습니다."
      />
    );
  }

  // -----------------------------------------------------------------------
  // 설문 폼 (status === 'pending')
  // -----------------------------------------------------------------------
  const displayScore = hovered > 0 ? hovered : score;

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-surface rounded-2xl border border-border-default p-8 flex flex-col gap-6">
        {/* 제목 영역 */}
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-text-primary">
            서비스 만족도 평가
          </h1>
          {survey?.ticket_title && (
            <p className="text-sm text-text-secondary line-clamp-2">
              {survey.ticket_title}
            </p>
          )}
        </div>

        {/* 별점 선택 */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setScore(star)}
                onMouseEnter={() => setHovered(star)}
                onMouseLeave={() => setHovered(0)}
                className="p-1 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded"
                aria-label={`${star}점 — ${SCORE_LABELS[star]}`}
              >
                <Star
                  size={32}
                  className={
                    star <= displayScore
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'fill-none text-border-default'
                  }
                  strokeWidth={1.5}
                />
              </button>
            ))}
          </div>
          {/* 점수 레이블 */}
          <p
            className="text-sm font-medium text-text-secondary transition-opacity"
            style={{ minHeight: '1.25rem' }}
          >
            {displayScore > 0 ? SCORE_LABELS[displayScore] : '별점을 선택해주세요'}
          </p>
        </div>

        {/* 코멘트 */}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="추가 의견을 입력해주세요 (선택)"
          rows={4}
          className={[
            'w-full rounded-lg border border-border-default bg-bg',
            'px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary',
            'resize-none outline-none transition-colors',
            'focus:border-accent-500 focus:ring-1 focus:ring-accent-500',
          ].join(' ')}
        />

        {/* 에러 메시지 */}
        {errorMsg && (
          <p className="text-sm text-destructive">{errorMsg}</p>
        )}

        {/* 제출 버튼 */}
        <Button
          size="md"
          disabled={score === 0 || mutation.isPending}
          onClick={() => {
            setErrorMsg('');
            mutation.mutate();
          }}
          className="w-full"
        >
          {mutation.isPending ? '제출 중...' : '제출하기'}
        </Button>
      </div>
    </div>
  );
}
