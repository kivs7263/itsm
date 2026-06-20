'use client';

/**
 * OnboardingWizard.tsx — 5단계 온보딩 위저드 (admin 신규 테넌트)
 *
 * 단계:
 *   1. 환영      — 서비스 소개
 *   2. 이메일    — SMTP 설정 (선택)
 *   3. SLA       — 기본 SLA 정책 안내 + 생성 (선택)
 *   4. 팀원 초대 — 첫 팀원 이메일 초대 (선택)
 *   5. 완료      — 체크리스트 + 시작하기
 *
 * 상태: tenant.settings.setup_completed 으로 관리
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Circle,
  Mail,
  Shield,
  Users,
  Zap,
  ChevronRight,
  X,
  Server,
  Clock,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------------
// 타입
// ------------------------------------------------------------------
interface SetupChecklist {
  smtp: boolean;
  sla: boolean;
  users_invited: boolean;
}

interface SetupStatus {
  setup_completed: boolean;
  checklist: SetupChecklist;
}

interface SmtpForm {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_from_email: string;
  smtp_from_name: string;
  smtp_use_tls: boolean;
}

interface SlaForm {
  grade: 'bronze' | 'silver' | 'gold' | 'platinum';
  response_minutes: number;
  resolve_minutes: number;
}

// ------------------------------------------------------------------
// 스텝 정의
// ------------------------------------------------------------------
const STEPS = [
  { label: '환영',      icon: Zap       },
  { label: '이메일',    icon: Mail      },
  { label: 'SLA',       icon: Shield    },
  { label: '팀원 초대', icon: Users     },
  { label: '완료',      icon: CheckCircle2 },
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4;

// ------------------------------------------------------------------
// 스텝 인디케이터
// ------------------------------------------------------------------
function StepIndicator({ current }: { current: StepIndex }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={step.label}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-200',
                  done
                    ? 'border-brand bg-brand text-white'
                    : active
                      ? 'border-brand bg-surface text-brand'
                      : 'border-border-default bg-surface text-text-secondary',
                )}
              >
                {done ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <span className="text-xs font-bold">{i + 1}</span>
                )}
              </div>
              <span className={cn(
                'text-[10px] font-medium',
                active ? 'text-text-primary' : 'text-text-secondary',
              )}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mb-5 transition-all duration-200',
                  done ? 'bg-brand' : 'bg-border-default',
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// Step 1: 환영
// ------------------------------------------------------------------
function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 py-4">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(18, 155, 142, 0.15)' }}
      >
        <Zap size={32} style={{ color: '#129B8E' }} />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-text-primary">Alveo ITSM에 오신 것을 환영합니다</h2>
        <p className="mt-2 text-sm text-text-secondary leading-relaxed">
          5단계 설정을 완료하면 IT 지원 업무를 바로 시작할 수 있습니다.
          <br />
          각 단계는 건너뛸 수 있으며, 설정은 나중에 언제든지 변경할 수 있습니다.
        </p>
      </div>

      <div className="w-full grid grid-cols-3 gap-3 mt-2">
        {[
          { icon: Mail,   label: '이메일 알림',  desc: '고객에게 진행 상황을 자동 발송' },
          { icon: Shield, label: 'SLA 관리',    desc: '응답 시간 기준으로 서비스 품질 보장' },
          { icon: Users,  label: '팀 협업',     desc: '팀원을 초대해 티켓을 함께 처리' },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="rounded-xl border border-border-subtle bg-surface p-4 flex flex-col items-center gap-2 text-center">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'rgba(18, 155, 142, 0.10)' }}
            >
              <Icon size={18} style={{ color: '#129B8E' }} />
            </div>
            <p className="text-xs font-semibold text-text-primary">{label}</p>
            <p className="text-[11px] text-text-secondary leading-tight">{desc}</p>
          </div>
        ))}
      </div>

      <Button className="w-full" onClick={onNext}>
        시작하기
        <ChevronRight size={14} className="ml-1" />
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------
// Step 2: 이메일 SMTP 설정
// ------------------------------------------------------------------
function EmailStep({
  tenantSlug,
  onNext,
  onSkip,
}: {
  tenantSlug: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SmtpForm>({
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    smtp_from_email: '',
    smtp_from_name: 'Alveo ITSM',
    smtp_use_tls: true,
  });

  const mutation = useMutation({
    mutationFn: (data: Partial<SmtpForm>) =>
      api.put(`/${tenantSlug}/notifications/config`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-status', tenantSlug] });
      toast.success('이메일 설정이 저장되었습니다.');
      onNext();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleSave = () => {
    if (!form.smtp_host || !form.smtp_from_email) {
      toast.error('SMTP 서버와 발신 이메일을 입력해주세요.');
      return;
    }
    mutation.mutate({
      smtp_host: form.smtp_host,
      smtp_port: form.smtp_port,
      smtp_user: form.smtp_user || undefined,
      smtp_password: form.smtp_password || undefined,
      smtp_from_email: form.smtp_from_email,
      smtp_from_name: form.smtp_from_name,
      smtp_use_tls: form.smtp_use_tls,
    });
  };

  const field = (
    label: string,
    key: keyof SmtpForm,
    type = 'text',
    placeholder = '',
  ) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-text-primary">{label}</label>
      <input
        type={type}
        value={form[key] as string}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(18, 155, 142, 0.12)' }}
        >
          <Server size={20} style={{ color: '#129B8E' }} />
        </div>
        <div>
          <h2 className="text-base font-bold text-text-primary">이메일 알림 설정</h2>
          <p className="text-xs text-text-secondary">SMTP 서버를 연결하면 고객에게 티켓 진행 상황을 자동으로 발송합니다.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {field('SMTP 서버', 'smtp_host', 'text', 'smtp.gmail.com')}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-primary">포트</label>
          <input
            type="number"
            value={form.smtp_port}
            onChange={(e) => setForm((f) => ({ ...f, smtp_port: Number(e.target.value) }))}
            className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>
      </div>

      {field('발신자 이메일 *', 'smtp_from_email', 'email', 'support@yourcompany.com')}
      {field('발신자 이름', 'smtp_from_name', 'text', 'IT 지원팀')}
      {field('SMTP 사용자명', 'smtp_user', 'text', 'user@gmail.com')}
      {field('SMTP 비밀번호', 'smtp_password', 'password', '앱 비밀번호 (Google 2FA 사용 시)')}

      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={form.smtp_use_tls}
          onClick={() => setForm((f) => ({ ...f, smtp_use_tls: !f.smtp_use_tls }))}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
            form.smtp_use_tls ? 'bg-brand' : 'bg-border-default',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
              form.smtp_use_tls ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>
        <span className="text-xs text-text-primary">TLS 암호화 사용</span>
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onSkip} className="flex-1">
          나중에 설정
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={mutation.isPending}
          className="flex-1"
        >
          {mutation.isPending ? '저장 중...' : '저장하고 계속'}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Step 3: SLA 정책
// ------------------------------------------------------------------
function SlaStep({
  tenantSlug,
  onNext,
  onSkip,
}: {
  tenantSlug: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const queryClient = useQueryClient();
  const DEFAULT_SLAS: SlaForm[] = [
    { grade: 'platinum', response_minutes: 15,  resolve_minutes: 240  },
    { grade: 'gold',     response_minutes: 60,  resolve_minutes: 480  },
    { grade: 'silver',   response_minutes: 240, resolve_minutes: 1440 },
    { grade: 'bronze',   response_minutes: 480, resolve_minutes: 2880 },
  ];
  const GRADE_LABELS: Record<string, string> = {
    platinum: 'Platinum (VIP)',
    gold: 'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
  };
  const GRADE_COLORS: Record<string, string> = {
    platinum: 'text-cyan-400',
    gold: 'text-yellow-400',
    silver: 'text-slate-400',
    bronze: 'text-orange-400',
  };

  const mutation = useMutation({
    mutationFn: () =>
      Promise.all(
        DEFAULT_SLAS.map((sla) =>
          api.post(`/${tenantSlug}/sla`, sla).catch(() => null),
        ),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-status', tenantSlug] });
      toast.success('SLA 정책 4종이 생성되었습니다.');
      onNext();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(18, 155, 142, 0.12)' }}
        >
          <Clock size={20} style={{ color: '#129B8E' }} />
        </div>
        <div>
          <h2 className="text-base font-bold text-text-primary">SLA 정책 설정</h2>
          <p className="text-xs text-text-secondary">계약 등급별 응답·해결 시간 기준을 자동으로 생성합니다.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border-default bg-surface overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-hover">
              <th className="text-left px-4 py-2.5 text-text-secondary font-medium">등급</th>
              <th className="text-right px-4 py-2.5 text-text-secondary font-medium">응답 시간</th>
              <th className="text-right px-4 py-2.5 text-text-secondary font-medium">해결 시간</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {DEFAULT_SLAS.map((sla) => (
              <tr key={sla.grade}>
                <td className="px-4 py-2.5">
                  <span className={cn('font-semibold', GRADE_COLORS[sla.grade])}>
                    {GRADE_LABELS[sla.grade]}
                  </span>
                </td>
                <td className="text-right px-4 py-2.5 text-text-secondary">
                  {sla.response_minutes < 60
                    ? `${sla.response_minutes}분`
                    : `${sla.response_minutes / 60}시간`}
                </td>
                <td className="text-right px-4 py-2.5 text-text-secondary">
                  {sla.resolve_minutes < 60
                    ? `${sla.resolve_minutes}분`
                    : sla.resolve_minutes < 1440
                      ? `${sla.resolve_minutes / 60}시간`
                      : `${sla.resolve_minutes / 1440}일`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-secondary">
        SLA 정책은 나중에 설정 &gt; SLA 정책 탭에서 수정할 수 있습니다.
      </p>

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip} className="flex-1">
          나중에 설정
        </Button>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex-1"
        >
          {mutation.isPending ? '생성 중...' : '기본 SLA 생성'}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Step 4: 팀원 초대
// ------------------------------------------------------------------
function InviteStep({
  tenantSlug,
  onNext,
  onSkip,
}: {
  tenantSlug: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'engineer' | 'team_lead' | 'admin'>('engineer');

  const ROLE_LABELS = { engineer: '엔지니어', team_lead: '팀장', admin: '관리자' };

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/settings/users/invite`, {
        email: email.trim(),
        name: name.trim(),
        role,
        password: Math.random().toString(36).slice(-10) + 'A1!',
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-status', tenantSlug] });
      toast.success(`${name || email}님을 초대했습니다.`);
      onNext();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleInvite = () => {
    if (!email.trim()) { toast.error('이메일을 입력해주세요.'); return; }
    if (!name.trim()) { toast.error('이름을 입력해주세요.'); return; }
    mutation.mutate();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(18, 155, 142, 0.12)' }}
        >
          <UserPlus size={20} style={{ color: '#129B8E' }} />
        </div>
        <div>
          <h2 className="text-base font-bold text-text-primary">첫 팀원 초대</h2>
          <p className="text-xs text-text-secondary">팀원을 초대하면 티켓을 함께 처리할 수 있습니다.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-primary">이메일 *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-primary">이름 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-primary">역할</label>
          <div className="flex gap-2">
            {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                  role === r
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border-default bg-surface text-text-secondary hover:border-border-strong',
                )}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-text-secondary">
        초대한 팀원은 임시 비밀번호로 로그인 후 변경할 수 있습니다.
        추가 초대는 설정 &gt; 사용자 관리에서 가능합니다.
      </p>

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip} className="flex-1">
          나중에 초대
        </Button>
        <Button
          size="sm"
          onClick={handleInvite}
          disabled={mutation.isPending}
          className="flex-1"
        >
          {mutation.isPending ? '초대 중...' : '초대하기'}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Step 5: 완료
// ------------------------------------------------------------------
function DoneStep({
  tenantSlug,
  checklist,
  onClose,
}: {
  tenantSlug: string;
  checklist: SetupChecklist;
  onClose: () => void;
}) {
  const completedCount = Object.values(checklist).filter(Boolean).length;
  const total = Object.keys(checklist).length;

  const ITEMS = [
    { key: 'smtp',           label: '이메일 알림 설정',  href: `/${tenantSlug}/settings?tab=notifications` },
    { key: 'sla',            label: 'SLA 정책 생성',    href: `/${tenantSlug}/settings?tab=sla` },
    { key: 'users_invited',  label: '팀원 초대',        href: `/${tenantSlug}/settings?tab=users` },
  ] as const;

  const completeMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/settings/setup/complete`).then((r) => r.data),
    onSuccess: onClose,
    onError: () => onClose(),
  });

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: 'rgba(34, 197, 94, 0.12)' }}
      >
        <CheckCircle2 size={32} className="text-success" />
      </div>

      <div className="text-center">
        <h2 className="text-xl font-bold text-text-primary">설정 완료!</h2>
        <p className="mt-1 text-sm text-text-secondary">
          {completedCount}/{total}개 항목을 완료했습니다. 이제 ITSM을 시작할 수 있습니다.
        </p>
      </div>

      <div className="w-full rounded-xl border border-border-default bg-surface divide-y divide-border-subtle overflow-hidden">
        {ITEMS.map(({ key, label, href }) => {
          const done = checklist[key];
          return (
            <div key={key} className="flex items-center gap-3 px-4 py-3">
              {done ? (
                <CheckCircle2 size={16} className="text-success shrink-0" />
              ) : (
                <Circle size={16} className="text-text-disabled shrink-0" />
              )}
              <span className={cn(
                'flex-1 text-sm',
                done ? 'text-text-primary' : 'text-text-secondary',
              )}>
                {label}
              </span>
              {!done && (
                <a
                  href={href}
                  onClick={onClose}
                  className="text-xs text-accent-500 hover:underline shrink-0"
                >
                  설정하기
                </a>
              )}
            </div>
          );
        })}
      </div>

      <Button
        className="w-full"
        onClick={() => completeMutation.mutate()}
        disabled={completeMutation.isPending}
      >
        {completeMutation.isPending ? '처리 중...' : '대시보드 시작하기'}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------
// 메인 위저드
// ------------------------------------------------------------------
interface OnboardingWizardProps {
  tenantSlug: string;
  onClose: () => void;
}

export function OnboardingWizard({ tenantSlug, onClose }: OnboardingWizardProps) {
  const [step, setStep] = useState<StepIndex>(0);
  const queryClient = useQueryClient();

  const { data: setupStatus } = useQuery<SetupStatus>({
    queryKey: ['setup-status', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/settings/setup`).then((r) => r.data),
    enabled: !!tenantSlug,
    staleTime: 30_000,
  });

  const next = () => setStep((s) => Math.min(s + 1, 4) as StepIndex);
  const skip = () => setStep((s) => Math.min(s + 1, 4) as StepIndex);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 백드롭 */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

      {/* 모달 */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-surface rounded-2xl shadow-2xl border border-border-default flex flex-col max-h-[90vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 pt-6 pb-0 shrink-0">
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: '#129B8E' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 14.5c0-2.76 2.24-5 5-5s5 2.24 5 5" />
                <rect x="7.5" y="14" width="2" height="3.5" rx="1" />
                <rect x="18.5" y="14" width="2" height="3.5" rx="1" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-text-primary">Alveo ITSM 시작하기</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="px-6 py-6">
          <StepIndicator current={step} />

          {step === 0 && <WelcomeStep onNext={next} />}
          {step === 1 && (
            <EmailStep tenantSlug={tenantSlug} onNext={next} onSkip={skip} />
          )}
          {step === 2 && (
            <SlaStep tenantSlug={tenantSlug} onNext={next} onSkip={skip} />
          )}
          {step === 3 && (
            <InviteStep tenantSlug={tenantSlug} onNext={next} onSkip={skip} />
          )}
          {step === 4 && (
            <DoneStep
              tenantSlug={tenantSlug}
              checklist={setupStatus?.checklist ?? { smtp: false, sla: false, users_invited: false }}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 훅: 온보딩 필요 여부 판단
// ------------------------------------------------------------------
export function useOnboarding(tenantSlug: string | undefined, isAdmin: boolean) {
  const { data } = useQuery<SetupStatus>({
    queryKey: ['setup-status', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/settings/setup`).then((r) => r.data),
    enabled: !!tenantSlug && isAdmin,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    needsOnboarding: isAdmin && data != null && !data.setup_completed,
  };
}
