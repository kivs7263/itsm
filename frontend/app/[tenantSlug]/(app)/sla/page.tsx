'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Download,
  Pencil,
  Plus,
  TicketIcon,
  Trash2,
  Save,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type {
  SlaDashboard,
  SlaPolicy,
  ContractTier,
  SlaEvent,
  SlaEventType,
  BusinessCalendar,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SLAPolicyModal } from '@/components/sla/SLAPolicyModal';

// -----------------------------------------------------------------------
// 시맨틱 색상 상수 (SVG/inline style용 — CSS 변수 불가 컨텍스트)
// -----------------------------------------------------------------------
const COLOR_SUCCESS = '#16a34a';
const COLOR_WARNING = '#d97706';
const COLOR_ERROR   = '#991b1b';
const COLOR_INFO    = '#2563eb';

// -----------------------------------------------------------------------
// 탭 타입
// -----------------------------------------------------------------------
type SlaTab = 'dashboard' | 'policies' | 'events' | 'calendar';

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------
// KPI 카드
// -----------------------------------------------------------------------
function KpiCard({ label, value, icon, color, isLoading }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  isLoading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border-default shadow-[var(--shadow-card)] bg-surface p-4 flex items-start gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: color + '1A' }}
      >
        <div style={{ color }}>{icon}</div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-secondary mb-1">{label}</p>
        {isLoading ? <Skeleton className="h-7 w-16" /> : (
          <p className="text-2xl font-bold text-text-primary">{value}</p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Tier 배지
// -----------------------------------------------------------------------
const TIER_STYLES: Record<ContractTier, string> = {
  bronze:   'bg-orange-50 text-orange-700',
  silver:   'bg-neutral-100 text-neutral-600',
  gold:     'bg-yellow-50 text-yellow-700',
  platinum: 'bg-blue-50 text-blue-700',
};

const TIER_LABELS: Record<ContractTier, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
};

function TierBadge({ tier }: { tier: ContractTier }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', TIER_STYLES[tier])}>
      {TIER_LABELS[tier]}
    </span>
  );
}

// -----------------------------------------------------------------------
// 준수율 게이지
// -----------------------------------------------------------------------
function ComplianceGauge({ rate }: { rate: number }) {
  const clamped = Math.max(0, Math.min(100, rate));
  const color = clamped >= 90 ? COLOR_SUCCESS : clamped >= 75 ? COLOR_WARNING : COLOR_ERROR;
  const circumference = 2 * Math.PI * 36;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="8" className="text-border-subtle" />
          <circle
            cx="40" cy="40" r="36" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-text-primary">{clamped.toFixed(1)}%</span>
        </div>
      </div>
      <p className="text-xs text-text-secondary">SLA 준수율</p>
    </div>
  );
}

// -----------------------------------------------------------------------
// 분 → 가독성 포맷
// -----------------------------------------------------------------------
function fmtMinutes(min: number): string {
  if (min < 60) return `${min}분`;
  if (min < 1440) return `${Math.round(min / 60)}시간`;
  return `${Math.round(min / 1440)}일`;
}

// -----------------------------------------------------------------------
// 탭 1: 대시보드
// -----------------------------------------------------------------------
function DashboardTab({ tenantSlug }: { tenantSlug: string }) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownloadPDF() {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const response = await api.get(`/${tenantSlug}/sla/report/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sla-report-${tenantSlug}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('PDF 다운로드에 실패했습니다.');
    } finally {
      setIsDownloading(false);
    }
  }

  const { data: dashboard, isLoading: dashLoading, isError: dashError, refetch: dashRefetch } = useQuery<SlaDashboard>({
    queryKey: ['sla-dashboard', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/sla/dashboard`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const { data: policies, isLoading: policiesLoading } = useQuery<SlaPolicy[]>({
    queryKey: ['sla-policies', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/sla/policies`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const policyList: SlaPolicy[] = Array.isArray(policies) ? policies : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDownloadPDF}
          disabled={isDownloading}
          leftIcon={<Download size={14} />}
        >
          {isDownloading ? '생성 중...' : 'PDF 내보내기'}
        </Button>
      </div>

      {/* KPI */}
      {dashError ? ( /* AS-W1 */
        <div className="flex items-center justify-center gap-2 py-6 text-text-secondary rounded-lg border border-border-subtle">
          <AlertTriangle size={14} className="text-error-text shrink-0" />
          <span className="text-sm">데이터를 불러오지 못했습니다.</span>
          <button
            onClick={() => dashRefetch()}
            className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium"
          >
            <RefreshCw size={10} />
            재시도
          </button>
        </div>
      ) : (
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="활성 티켓" value={dashboard?.active_tickets ?? 0} icon={<TicketIcon size={20} />} color={COLOR_INFO} isLoading={dashLoading} />
        <KpiCard label="SLA 위반" value={dashboard?.sla_violations ?? 0} icon={<AlertTriangle size={20} />} color={COLOR_ERROR} isLoading={dashLoading} />
        <KpiCard label="경고" value={dashboard?.sla_warnings ?? 0} icon={<Clock size={20} />} color={COLOR_WARNING} isLoading={dashLoading} />
        <KpiCard label="준수율" value={`${(dashboard?.compliance_rate ?? 0).toFixed(1)}%`} icon={<CheckCircle size={20} />} color={COLOR_SUCCESS} isLoading={dashLoading} />
      </div>
      )}

      {/* 정책 요약 + 게이지 */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-lg border border-border-default shadow-[var(--shadow-card)] bg-surface">
          <div className="px-5 py-4 border-b border-border-subtle">
            <h2 className="text-sm font-semibold text-text-primary">SLA 정책 요약</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">등급</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">응답 시간</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">해결 시간</th>
              </tr>
            </thead>
            <tbody>
              {policiesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle">
                    <td className="px-5 py-3"><Skeleton className="h-6 w-16 rounded-full" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                  </tr>
                ))
              ) : policyList.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm text-text-secondary">등록된 SLA 정책이 없습니다.</td>
                </tr>
              ) : (
                policyList.map((p) => (
                  <tr key={p.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-5 py-3"><TierBadge tier={p.grade} /></td>
                    <td className="px-5 py-3 text-text-primary">{fmtMinutes(p.response_minutes)}</td>
                    <td className="px-5 py-3 text-text-primary">{fmtMinutes(p.resolution_minutes)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border-default shadow-[var(--shadow-card)] bg-surface flex items-center justify-center p-6">
          {dashLoading ? (
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="h-24 w-24 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          ) : (
            <ComplianceGauge rate={dashboard?.compliance_rate ?? 0} />
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 2: 정책 관리 (CRUD)
// -----------------------------------------------------------------------
function PoliciesTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<SlaPolicy | null>(null);

  const { data: policies, isLoading, isError: policiesError, refetch: policiesRefetch } = useQuery<SlaPolicy[]>({
    queryKey: ['sla-policies', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/sla/policies`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const policyList: SlaPolicy[] = Array.isArray(policies) ? policies : [];

  function openCreate() { setEditingPolicy(null); setPolicyModalOpen(true); }
  function openEdit(p: SlaPolicy) { setEditingPolicy(p); setPolicyModalOpen(true); }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">등급별 SLA 목표 시간(분)을 설정합니다. 같은 등급 재저장 시 기존 값을 덮어씁니다.</p>
        <Button size="sm" onClick={openCreate} leftIcon={<Plus size={14} />}>
          정책 추가
        </Button>
      </div>

      <div className="rounded-lg border border-border-default bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">등급</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">응답 시간</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">해결 시간</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">등록일</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-text-secondary">액션</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  <td className="px-5 py-3"><Skeleton className="h-6 w-16 rounded-full" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-5 py-3" />
                </tr>
              ))
            ) : policiesError ? ( /* AS-W1 */
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center">
                  <AlertTriangle size={24} className="mx-auto mb-2 text-error-text" />
                  <p className="text-sm text-text-secondary mb-2">데이터를 불러오지 못했습니다.</p>
                  <button
                    onClick={() => policiesRefetch()}
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium"
                  >
                    <RefreshCw size={11} />
                    다시 시도
                  </button>
                </td>
              </tr>
            ) : policyList.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-text-secondary">
                  등록된 SLA 정책이 없습니다. 정책 추가 버튼으로 생성하세요.
                </td>
              </tr>
            ) : (
              policyList.map((p) => (
                <tr key={p.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover transition-colors">
                  <td className="px-5 py-3"><TierBadge tier={p.grade} /></td>
                  <td className="px-5 py-3 text-text-primary">{fmtMinutes(p.response_minutes)}</td>
                  <td className="px-5 py-3 text-text-primary">{fmtMinutes(p.resolution_minutes)}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs">
                    {new Date(p.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Pencil size={13} />}
                      onClick={() => openEdit(p)}
                    >
                      수정
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SLAPolicyModal
        open={policyModalOpen}
        onClose={() => setPolicyModalOpen(false)}
        tenantSlug={tenantSlug}
        policy={editingPolicy}
      />
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 3: SLA 이벤트 목록
// -----------------------------------------------------------------------
const EVENT_STYLES: Record<SlaEventType, string> = {
  breach_warning: 'bg-warning-bg text-warning-text',
  breached:       'bg-error-bg text-error-text',
  resolved:       'bg-success-bg text-success-text',
};
const EVENT_LABELS: Record<SlaEventType, string> = {
  breach_warning: '위반 경고',
  breached:       'SLA 위반',
  resolved:       '해결',
};

interface SlaEventsResp {
  items: SlaEvent[];
  total: number;
}

function EventsTab({ tenantSlug }: { tenantSlug: string }) {
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<string>('all');
  const [since, setSince] = useState('');

  const { data, isLoading, isError: eventsError, refetch: eventsRefetch } = useQuery<SlaEventsResp>({
    queryKey: ['sla-events', tenantSlug, page, filterType, since],
    queryFn: () =>
      api.get(`/${tenantSlug}/sla/events`, {
        params: {
          page,
          page_size: PAGE_SIZE,
          ...(filterType !== 'all' ? { event_type: filterType } : {}),
          ...(since ? { since } : {}),
        },
      }).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const events: SlaEvent[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="flex items-center gap-3">
        <div className="w-40">
          <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1); }}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">유형 전체</SelectItem>
              <SelectItem value="breach_warning">위반 경고</SelectItem>
              <SelectItem value="breached">SLA 위반</SelectItem>
              <SelectItem value="resolved">해결</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <input
          type="datetime-local"
          value={since}
          onChange={(e) => { setSince(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-border-default bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
        />
        {since && (
          <button onClick={() => { setSince(''); setPage(1); }} className="text-xs text-text-secondary hover:text-text-primary">초기화</button>
        )}
      </div>

      <div className="rounded-lg border border-border-default bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">유형</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">티켓 ID</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">발생 시각</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  <td className="px-5 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-64 font-mono" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-36" /></td>
                </tr>
              ))
            ) : eventsError ? ( /* AS-W1 */
              <tr>
                <td colSpan={3} className="px-5 py-12 text-center">
                  <AlertTriangle size={24} className="mx-auto mb-2 text-error-text" />
                  <p className="text-sm text-text-secondary mb-2">데이터를 불러오지 못했습니다.</p>
                  <button
                    onClick={() => eventsRefetch()}
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium"
                  >
                    <RefreshCw size={11} />
                    다시 시도
                  </button>
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-12 text-center text-sm text-text-secondary">
                  {filterType !== 'all' || since ? '조건에 맞는 이벤트가 없습니다.' : '기록된 SLA 이벤트가 없습니다.'}
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover transition-colors">
                  <td className="px-5 py-3">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', EVENT_STYLES[e.event_type] ?? 'text-text-secondary bg-neutral-100')}>
                      {EVENT_LABELS[e.event_type] ?? e.event_type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-text-secondary text-xs font-mono">{e.ticket_id}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs whitespace-nowrap">
                    {new Date(e.fired_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
          <span className="text-xs text-text-secondary">{page} / {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</Button>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 4: 업무시간 캘린더
// -----------------------------------------------------------------------
const DAYS_KO: Record<string, string> = {
  mon: '월요일', tue: '화요일', wed: '수요일', thu: '목요일',
  fri: '금요일', sat: '토요일', sun: '일요일',
};
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface DayHours {
  enabled: boolean;
  intervals: [string, string][];
}

function initDayHours(bh?: Record<string, string[][]>): Record<string, DayHours> {
  return Object.fromEntries(
    DAY_ORDER.map((d) => {
      const intervals = bh?.[d] ?? [];
      return [d, { enabled: intervals.length > 0, intervals: intervals.length > 0 ? (intervals as [string, string][]) : [['09:00', '18:00']] }];
    }),
  );
}

const TIMEZONES = [
  'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'UTC',
  'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin',
];

function CalendarTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();

  const { data: cal, isLoading, isError: calError, refetch: calRefetch } = useQuery<BusinessCalendar | null>({
    queryKey: ['sla-business-calendar', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/sla/business-calendar`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const [dayHours, setDayHours] = useState<Record<string, DayHours>>(() => initDayHours());
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState('');
  const [saving, setSaving] = useState(false);
  const [initialised, setInitialised] = useState(false);

  // 서버 데이터로 초기화 (한 번만)
  React.useEffect(() => {
    if (!isLoading && !initialised) {
      if (cal) {
        setDayHours(initDayHours(cal.business_hours_json));
        setTimezone(cal.timezone ?? 'Asia/Seoul');
        setHolidays(cal.holidays_json ?? []);
      } else {
        setDayHours(initDayHours());
        setTimezone('Asia/Seoul');
        setHolidays([]);
      }
      setInitialised(true);
    }
  }, [cal, isLoading, initialised]);

  function toggleDay(day: string) {
    setDayHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], enabled: !prev[day].enabled },
    }));
  }

  function updateInterval(day: string, idx: number, part: 0 | 1, value: string) {
    setDayHours((prev) => {
      const intervals = [...prev[day].intervals] as [string, string][];
      const pair = [...intervals[idx]] as [string, string];
      pair[part] = value;
      intervals[idx] = pair;
      return { ...prev, [day]: { ...prev[day], intervals } };
    });
  }

  function addHoliday() {
    const v = newHoliday.trim();
    if (!v || holidays.includes(v)) return;
    setHolidays((prev) => [...prev, v].sort());
    setNewHoliday('');
  }

  function removeHoliday(h: string) {
    setHolidays((prev) => prev.filter((x) => x !== h));
  }

  async function handleSave() {
    const business_hours_json: Record<string, string[][]> = {};
    for (const [day, dh] of Object.entries(dayHours)) {
      business_hours_json[day] = dh.enabled ? dh.intervals : [];
    }
    setSaving(true);
    try {
      await api.put(`/${tenantSlug}/sla/business-calendar`, {
        business_hours_json,
        timezone,
        holidays_json: holidays,
      });
      queryClient.invalidateQueries({ queryKey: ['sla-business-calendar', tenantSlug] });
      toast.success('업무시간 캘린더가 저장되었습니다.');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    );
  }

  if (calError) { /* AS-W1 */
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-secondary">
        <AlertTriangle size={24} className="text-error-text" />
        <p className="text-sm">업무시간 캘린더를 불러오지 못했습니다.</p>
        <button
          onClick={() => calRefetch()}
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
        >
          <RefreshCw size={11} />
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 안내 */}
      <div className="rounded-lg border border-info-bg bg-info-bg px-4 py-3 text-xs text-info-text">
        요일별 영업시간을 설정합니다. 저장 후 신규 티켓부터 업무시간 기반 SLA deadline이 적용됩니다.
        비활성화된 요일은 종일 휴무로 처리됩니다.
      </div>

      {/* 타임존 */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-text-primary">타임존</label>
        <div className="w-56">
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 요일별 시간 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-text-primary">요일별 영업시간</label>
        <div className="rounded-lg border border-border-default bg-surface divide-y divide-border-subtle">
          {DAY_ORDER.map((day) => {
            const dh = dayHours[day];
            if (!dh) return null;
            return (
              <div key={day} className="flex items-center gap-4 px-4 py-3">
                <button
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
                    dh.enabled ? 'bg-brand' : 'bg-border-default',
                  )}
                >
                  <span
                    className={cn(
                      'absolute h-4 w-4 rounded-full bg-white shadow transition-transform',
                      dh.enabled ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </button>
                <span className="w-16 text-sm text-text-primary shrink-0">{DAYS_KO[day]}</span>
                {dh.enabled ? (
                  <div className="flex items-center gap-2">
                    {dh.intervals.map((iv, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <input
                          type="time"
                          value={iv[0]}
                          onChange={(e) => updateInterval(day, idx, 0, e.target.value)}
                          className="h-7 w-28 rounded border border-border-default bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-border-strong"
                        />
                        <span className="text-text-secondary text-xs">~</span>
                        <input
                          type="time"
                          value={iv[1]}
                          onChange={(e) => updateInterval(day, idx, 1, e.target.value)}
                          className="h-7 w-28 rounded border border-border-default bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-border-strong"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-text-disabled">휴무</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 공휴일 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-text-primary">공휴일 목록 (종일 휴무)</label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            className="h-8 rounded-md border border-border-default bg-surface px-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
          <Button size="sm" variant="ghost" onClick={addHoliday} leftIcon={<Plus size={13} />}>추가</Button>
        </div>
        {holidays.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {holidays.map((h) => (
              <span key={h} className="flex items-center gap-1 rounded-full bg-surface-raised border border-border-subtle px-2.5 py-1 text-xs text-text-primary">
                {h}
                <button onClick={() => removeHoliday(h)} className="ml-1 text-text-disabled hover:text-error-text transition-colors">
                  <Trash2 size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-disabled">등록된 공휴일이 없습니다.</p>
        )}
      </div>

      {/* 저장 버튼 */}
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={saving} leftIcon={<Save size={14} />}>
          업무시간 저장
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// SLA 메인 페이지
// -----------------------------------------------------------------------
export default function SLAPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const [activeTab, setActiveTab] = useState<SlaTab>('dashboard');

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">SLA</h1>
      </div>

      {/* 탭 바 */}
      <div className="flex border-b border-border-subtle bg-surface shrink-0 px-6">
        <TabButton label="대시보드" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
        <TabButton label="정책 관리" active={activeTab === 'policies'} onClick={() => setActiveTab('policies')} />
        <TabButton label="이벤트 로그" active={activeTab === 'events'} onClick={() => setActiveTab('events')} />
        <TabButton label="업무시간 캘린더" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'dashboard' && <DashboardTab tenantSlug={tenantSlug} />}
        {activeTab === 'policies'  && <PoliciesTab tenantSlug={tenantSlug} />}
        {activeTab === 'events'    && <EventsTab tenantSlug={tenantSlug} />}
        {activeTab === 'calendar'  && <CalendarTab tenantSlug={tenantSlug} />}
      </div>
    </div>
  );
}
