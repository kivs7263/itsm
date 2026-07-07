'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// ─── 타입 선언 ─────────────────────────────────────────────────────────────

interface TicketSummary {
  ticket_id: string;
  ticket_number: string | null;
  title: string;
  status: string;
  priority: string;
  escalation_level: number;
  escalation_count: number;
  created_at: string;
  updated_at: string;
  current_team_name: string | null;
  customer_name: string | null;
}

interface TimelineEvent {
  type: 'status_change' | 'comment' | 'escalation';
  content: string;
  created_at: string;
}

// ─── 한글 레이블 맵 ────────────────────────────────────────────────────────

const STATUS_KR: Record<string, string> = {
  open: '접수됨',
  in_progress: '처리 중',
  pending: '대기 중',
  resolved: '처리 완료',
  closed: '종료',
};

const PRIORITY_KR: Record<string, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '긴급',
};

// ─── 상태 배지 색상 ────────────────────────────────────────────────────────

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-blue-100 text-blue-800';
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-800';
    case 'pending':
      return 'bg-gray-100 text-gray-700';
    case 'resolved':
      return 'bg-green-100 text-green-800';
    case 'closed':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function priorityBadgeClass(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-100 text-red-800';
    case 'high':
      return 'bg-orange-100 text-orange-800';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800';
    case 'low':
      return 'bg-gray-100 text-gray-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

// ─── 날짜 포맷 헬퍼 ────────────────────────────────────────────────────────

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export default function MagicPortalPage() {
  const params = useParams();
  const token = typeof params.token === 'string' ? params.token : '';

  const [state, setState] = useState<'loading' | 'error' | 'loaded'>('loading');
  const [ticketInfo, setTicketInfo] = useState<TicketSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 타임라인 로드 함수 (코멘트 전송 후 재사용)
  async function loadTimeline(tk: string): Promise<TimelineEvent[]> {
    const res = await fetch(`/api/portal/${tk}/timeline`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    // 백엔드가 { events: [...] } 또는 배열 직접 반환하는 두 형태 모두 대응
    if (Array.isArray(data)) return data as TimelineEvent[];
    if (Array.isArray(data?.events)) return data.events as TimelineEvent[];
    if (Array.isArray(data?.comments)) return data.comments as TimelineEvent[];
    return [];
  }

  // 초기 데이터 로드
  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const [verifyRes, tl] = await Promise.all([
          fetch(`/api/portal/verify/${token}`, { cache: 'no-store' }),
          loadTimeline(token),
        ]);

        if (cancelled) return;

        if (!verifyRes.ok) {
          setState('error');
          return;
        }

        const ticket = (await verifyRes.json()) as TicketSummary;

        if (cancelled) return;
        setTicketInfo(ticket);
        setTimeline(tl);
        setState('loaded');
      } catch {
        if (!cancelled) setState('error');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 코멘트 전송
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim() || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/portal/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: comment.trim() }),
      });

      if (!res.ok) {
        setSubmitError('전송에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      setComment('');
      // 타임라인 리로드
      const updated = await loadTimeline(token);
      setTimeline(updated);
    } catch {
      setSubmitError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── 로딩 ──────────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-amber-500 animate-spin" />
            <p className="text-sm text-gray-500">정보를 불러오는 중...</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── 에러 ──────────────────────────────────────────────────────────────

  if (state === 'error' || !ticketInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">링크를 확인해 주세요</h2>
            <p className="text-sm text-gray-500">
              유효하지 않은 링크이거나 만료되었습니다.
              <br />
              이메일로 받은 링크를 다시 확인해 주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── 로드 성공 ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
        {/* 티켓 정보 카드 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              {ticketInfo.ticket_number && (
                <p className="text-xs font-mono text-gray-400 mb-1">
                  #{ticketInfo.ticket_number}
                </p>
              )}
              <h2 className="text-lg font-semibold text-gray-900 leading-snug">
                {ticketInfo.title}
              </h2>
            </div>
          </div>

          {/* 배지 그룹 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {/* 상태 */}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(ticketInfo.status)}`}>
              {STATUS_KR[ticketInfo.status] ?? ticketInfo.status}
            </span>

            {/* 우선순위 */}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityBadgeClass(ticketInfo.priority)}`}>
              우선순위: {PRIORITY_KR[ticketInfo.priority] ?? ticketInfo.priority}
            </span>

            {/* 에스컬레이션 레벨 */}
            {ticketInfo.escalation_level > 1 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                에스컬레이션 Lv.{ticketInfo.escalation_level}
              </span>
            )}
          </div>

          {/* 메타 정보 */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {ticketInfo.current_team_name && (
              <>
                <dt className="text-gray-500">담당팀</dt>
                <dd className="text-gray-900 font-medium">{ticketInfo.current_team_name}</dd>
              </>
            )}
            {ticketInfo.customer_name && (
              <>
                <dt className="text-gray-500">고객명</dt>
                <dd className="text-gray-900">{ticketInfo.customer_name}</dd>
              </>
            )}
            <dt className="text-gray-500">접수일시</dt>
            <dd className="text-gray-900">{formatDate(ticketInfo.created_at)}</dd>
            <dt className="text-gray-500">최종 업데이트</dt>
            <dd className="text-gray-900">{formatDate(ticketInfo.updated_at)}</dd>
          </dl>
        </div>

        {/* 타임라인 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">처리 내역</h3>

          {timeline.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">아직 처리 내역이 없습니다.</p>
          ) : (
            <ol className="space-y-4">
              {timeline.map((event, idx) => (
                <li key={idx} className="flex gap-3">
                  {/* 아이콘 */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base
                    ${event.type === 'escalation'
                      ? 'bg-orange-100 text-orange-600'
                      : event.type === 'comment'
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-blue-50 text-blue-500'
                    }`}>
                    {event.type === 'escalation' && '🔀'}
                    {event.type === 'comment' && '💬'}
                    {event.type === 'status_change' && '🔄'}
                  </div>

                  {/* 내용 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 leading-relaxed">{event.content}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(event.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* 코멘트 폼 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">추가 문의</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="추가 문의사항이 있으시면 입력해 주세요"
              rows={4}
              disabled={submitting}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900
                placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400
                focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
            />
            {submitError && (
              <p className="text-xs text-red-500">{submitError}</p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !comment.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                  btn-warning text-gray-900 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-700/30 border-t-gray-900 animate-spin" />
                    전송 중...
                  </>
                ) : (
                  '전송'
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

// ─── 공통 헤더 ─────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">ITSM 고객 포털</span>
        <span className="text-xs text-gray-400">Alveo by apistech</span>
      </div>
    </header>
  );
}
