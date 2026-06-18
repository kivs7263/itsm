'use client';

/**
 * settings/page.tsx — 관리자 전용 Settings 페이지
 *
 * 탭 구조: 사용자 관리 | 알림 채널 | SLA 정책 | 분류 체계
 * admin 역할만 접근 가능 — isAdminRole(role) 체크
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Bell,
  Clock,
  Tag,
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ShieldOff,
  PhoneForwarded,
  History,
  Mail,
  Key,
  Webhook,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Zap,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { isAdminRole, type UserRole } from '@/lib/auth';
import type {
  UserSetting,
  NotificationConfig,
  SlaPolicy,
  SymptomCategoryItem,
  SupportTeam,
  ExtNotifLog,
  SubscriptionInfo,
  StripeInvoice,
} from '@/lib/types';

// -----------------------------------------------------------------------
// 상수
// -----------------------------------------------------------------------
const ROLE_LABELS: Record<string, string> = {
  engineer: '엔지니어',
  team_lead: '팀장',
  admin: '관리자',
  sales: '영업',
  c_level: 'C-레벨',
};

const ROLE_OPTIONS = ['engineer', 'team_lead', 'admin', 'sales', 'c_level'] as const;

const TIER_LABELS: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

const TIER_COLORS: Record<string, string> = {
  bronze: 'text-orange-400',
  silver: 'text-slate-400',
  gold: 'text-yellow-400',
  platinum: 'text-cyan-400',
};

// -----------------------------------------------------------------------
// 탭 정의
// -----------------------------------------------------------------------
type TabId = 'users' | 'notifications' | 'sla' | 'categories' | 'support-teams' | 'ext-notif-history' | 'email-inbound' | 'api-keys' | 'webhooks' | 'billing' | 'general';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'users',             label: '사용자 관리',    icon: Users          },
  { id: 'notifications',     label: '알림 채널',      icon: Bell           },
  { id: 'email-inbound',     label: '이메일 수신',    icon: Mail           },
  { id: 'sla',               label: 'SLA 정책',       icon: Clock          },
  { id: 'categories',        label: '분류 체계',      icon: Tag            },
  { id: 'support-teams',     label: '지원팀 관리',    icon: PhoneForwarded },
  { id: 'ext-notif-history', label: '외부 알림 이력', icon: History        },
  { id: 'api-keys',          label: 'API 키',         icon: Key            },
  { id: 'webhooks',          label: 'Webhook',        icon: Webhook        },
  { id: 'billing',           label: '구독',           icon: Zap            },
  { id: 'general',           label: '일반',           icon: Globe          },
];

// -----------------------------------------------------------------------
// 공통 스켈레톤
// -----------------------------------------------------------------------
function RowSkeletons({ cols = 4 }: { cols?: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-border-subtle">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 탭 1: 사용자 관리
// -----------------------------------------------------------------------
function UsersTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ email: '', name: '', role: 'engineer', password: '' });

  const { data, isLoading } = useQuery<{ items: UserSetting[] }>({
    queryKey: ['settings-users', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/settings/users`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const inviteMutation = useMutation({
    mutationFn: (body: typeof invite) =>
      api.post(`/${tenantSlug}/settings/users/invite`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('사용자가 초대되었습니다.');
      setShowInvite(false);
      setInvite({ email: '', name: '', role: 'engineer', password: '' });
      queryClient.invalidateQueries({ queryKey: ['settings-users', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/${tenantSlug}/settings/users/${id}/role`, { role }).then((r) => r.data),
    onSuccess: () => {
      toast.success('역할이 변경되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['settings-users', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api
        .patch(`/${tenantSlug}/settings/users/${id}/${is_active ? 'deactivate' : 'activate'}`)
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('사용자 상태가 변경되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['settings-users', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const users = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          테넌트에 속한 사용자를 관리합니다.
        </p>
        <Button
          size="sm"
          leftIcon={<Plus size={14} />}
          onClick={() => setShowInvite((v) => !v)}
        >
          사용자 초대
        </Button>
      </div>

      {/* 초대 폼 */}
      {showInvite && (
        <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-text-primary">새 사용자 초대</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">이름</label>
              <input
                type="text"
                value={invite.name}
                onChange={(e) => setInvite((v) => ({ ...v, name: e.target.value }))}
                className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="홍길동"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">이메일</label>
              <input
                type="email"
                value={invite.email}
                onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))}
                className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="user@example.com"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">역할</label>
              <select
                value={invite.role}
                onChange={(e) => setInvite((v) => ({ ...v, role: e.target.value }))}
                className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">초기 비밀번호</label>
              <input
                type="password"
                value={invite.password}
                onChange={(e) => setInvite((v) => ({ ...v, password: e.target.value }))}
                className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="••••••••"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowInvite(false)}>
              취소
            </Button>
            <Button
              size="sm"
              isLoading={inviteMutation.isPending}
              onClick={() => inviteMutation.mutate(invite)}
              disabled={!invite.email || !invite.name || !invite.password}
            >
              초대
            </Button>
          </div>
        </div>
      )}

      {/* 사용자 테이블 */}
      <div className="overflow-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이름</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이메일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">역할</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <RowSkeletons cols={4} />
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-text-secondary">
                  사용자가 없습니다.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  className={cn(
                    'border-b border-border-subtle transition-colors hover:bg-surface-hover',
                    !u.is_active && 'opacity-50',
                  )}
                >
                  <td className="px-4 py-3 text-text-primary font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value })}
                      className="rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleActiveMutation.mutate({ id: u.id, is_active: u.is_active })}
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                        u.is_active
                          ? 'bg-success-bg text-success-text hover:bg-error-bg hover:text-error-text'
                          : 'bg-error-bg text-error-text hover:bg-success-bg hover:text-success-text',
                      )}
                    >
                      {u.is_active ? '활성' : '비활성'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 2: 알림 채널 설정
// -----------------------------------------------------------------------
interface ChannelSectionProps {
  title: string;
  fields: { key: keyof NotificationConfig; label: string; placeholder: string }[];
  values: Partial<NotificationConfig>;
  onChange: (key: keyof NotificationConfig, value: string) => void;
  onSave: () => void;
  isSaving: boolean;
}

function ChannelSection({ title, fields, values, onChange, onSave, isSaving }: ChannelSectionProps) {
  return (
    <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {fields.map(({ key, label, placeholder }) => (
        <div key={key} className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary">{label}</label>
          <input
            type="text"
            value={typeof values[key] === 'string' ? (values[key] as string) : ''}
            onChange={(e) => onChange(key, e.target.value)}
            className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder={values[key] ? '••••••••••••' : placeholder}
          />
        </div>
      ))}
      <div className="flex justify-end">
        <Button size="sm" isLoading={isSaving} onClick={onSave}>
          저장
        </Button>
      </div>
    </div>
  );
}

function NotificationsTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Partial<NotificationConfig>>({});
  const [smtpPassword, setSmtpPassword] = useState('');

  const { data: configData } = useQuery<NotificationConfig>({
    queryKey: ['notif-config', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/notifications/config`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  useEffect(() => {
    if (configData) {
      setDraft(configData);
    }
  }, [configData]);

  const saveMutation = useMutation({
    mutationFn: (body: Partial<NotificationConfig> & { smtp_password?: string }) =>
      api.put(`/${tenantSlug}/notifications/config`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('채널 설정이 저장되었습니다.');
      setSmtpPassword('');
      queryClient.invalidateQueries({ queryKey: ['notif-config', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleChange = (key: keyof NotificationConfig, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value || null }));
  };

  const handleSave = () => {
    const body: Partial<NotificationConfig> & { smtp_password?: string } = { ...draft };
    if (smtpPassword) {
      body.smtp_password = smtpPassword;
    }
    saveMutation.mutate(body);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        알림을 발송할 외부 채널을 설정합니다. 값이 이미 저장된 경우 마스킹 처리됩니다.
      </p>

      <ChannelSection
        title="Slack"
        fields={[{ key: 'slack_webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/...' }]}
        values={draft}
        onChange={handleChange}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />

      <ChannelSection
        title="MS Teams"
        fields={[{ key: 'teams_webhook_url', label: 'Webhook URL', placeholder: 'https://xxx.webhook.office.com/...' }]}
        values={draft}
        onChange={handleChange}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />

      <ChannelSection
        title="카카오"
        fields={[
          { key: 'kakao_api_key', label: 'API Key', placeholder: 'kakao api key' },
          { key: 'kakao_sender_key', label: 'Sender Key', placeholder: 'kakao sender key' },
        ]}
        values={draft}
        onChange={handleChange}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />

      <ChannelSection
        title="카카오 알림톡 템플릿"
        fields={[
          { key: 'kakao_template_ticket_created', label: '티켓 생성 템플릿 코드', placeholder: 'TICKET_CREATED' },
          { key: 'kakao_template_escalated',      label: '에스컬레이션 템플릿 코드', placeholder: 'TICKET_ESCALATED' },
          { key: 'kakao_template_resolved',       label: '해결 완료 템플릿 코드', placeholder: 'TICKET_RESOLVED' },
        ]}
        values={draft}
        onChange={handleChange}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />

      <ChannelSection
        title="SMS"
        fields={[
          { key: 'sms_api_key', label: 'API Key', placeholder: 'sms api key' },
          { key: 'sms_api_secret', label: 'API Secret', placeholder: 'sms api secret' },
          { key: 'sms_from_number', label: '발신 번호', placeholder: '01012345678' },
        ]}
        values={draft}
        onChange={handleChange}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />

      {/* SMTP 섹션 — 비밀번호는 별도 state 관리 */}
      <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-text-primary">SMTP (이메일)</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">SMTP 서버</label>
            <input
              type="text"
              value={typeof draft.smtp_host === 'string' ? draft.smtp_host : ''}
              onChange={(e) => handleChange('smtp_host', e.target.value)}
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="smtp.gmail.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">포트</label>
            <input
              type="number"
              value={draft.smtp_port ?? ''}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  smtp_port: e.target.value ? Number(e.target.value) : null,
                }))
              }
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="587"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">계정</label>
            <input
              type="text"
              value={typeof draft.smtp_user === 'string' ? draft.smtp_user : ''}
              onChange={(e) => handleChange('smtp_user', e.target.value)}
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="user@example.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">
              비밀번호
              {configData?.smtp_password_configured && (
                <span className="ml-2 text-xs text-green-600">✓ 비밀번호 설정됨</span>
              )}
            </label>
            <input
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="비밀번호 (저장 시에만 전송)"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">발신 이메일</label>
            <input
              type="text"
              value={typeof draft.smtp_from_email === 'string' ? draft.smtp_from_email : ''}
              onChange={(e) => handleChange('smtp_from_email', e.target.value)}
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="noreply@company.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">발신자 이름</label>
            <input
              type="text"
              value={typeof draft.smtp_from_name === 'string' ? draft.smtp_from_name : ''}
              onChange={(e) => handleChange('smtp_from_name', e.target.value)}
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="ITSM 고객지원"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.smtp_use_tls ?? false}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, smtp_use_tls: e.target.checked }))
            }
            className="rounded border-border-default accent-accent"
          />
          <span className="text-xs text-text-secondary">TLS 사용</span>
        </label>

        <div className="flex justify-end">
          <Button size="sm" isLoading={saveMutation.isPending} onClick={handleSave}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 3: SLA 정책
// -----------------------------------------------------------------------
function SlaTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [draftHours, setDraftHours] = useState<Record<string, { response_hours: number; resolution_hours: number }>>({});

  const { data, isLoading } = useQuery<SlaPolicy[]>({
    queryKey: ['sla-policies', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/sla/policies`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  useEffect(() => {
    if (data) {
      const initial: typeof draftHours = {};
      data.forEach((p) => {
        initial[p.id] = { response_hours: p.response_hours, resolution_hours: p.resolution_hours };
      });
      setDraftHours(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { response_hours: number; resolution_hours: number } }) =>
      api.put(`/${tenantSlug}/sla/policies/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('SLA 정책이 저장되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['sla-policies', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const policies = data ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        계약 등급별 응답 시간(시간)과 해결 시간(시간)을 설정합니다.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(['bronze', 'silver', 'gold', 'platinum'] as const).map((tier) => {
          const policy = policies.find((p) => p.tier === tier);
          if (!policy) return null;
          const d = draftHours[policy.id] ?? {
            response_hours: policy.response_hours,
            resolution_hours: policy.resolution_hours,
          };

          return (
            <div key={tier} className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
              <p className={cn('text-sm font-semibold', TIER_COLORS[tier])}>
                {TIER_LABELS[tier]}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-text-secondary">응답 시간 (시간)</label>
                  <input
                    type="number"
                    min={1}
                    value={d.response_hours}
                    onChange={(e) =>
                      setDraftHours((prev) => ({
                        ...prev,
                        [policy.id]: { ...d, response_hours: Number(e.target.value) },
                      }))
                    }
                    className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-text-secondary">해결 시간 (시간)</label>
                  <input
                    type="number"
                    min={1}
                    value={d.resolution_hours}
                    onChange={(e) =>
                      setDraftHours((prev) => ({
                        ...prev,
                        [policy.id]: { ...d, resolution_hours: Number(e.target.value) },
                      }))
                    }
                    className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  isLoading={saveMutation.isPending && saveMutation.variables?.id === policy.id}
                  onClick={() => saveMutation.mutate({ id: policy.id, body: d })}
                >
                  저장
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 4: 분류 체계 — 트리 항목 컴포넌트
// -----------------------------------------------------------------------
interface CategoryItemRowProps {
  item: SymptomCategoryItem;
  depth: number;
  onEdit: (item: SymptomCategoryItem) => void;
  onDelete: (id: string) => void;
}

function CategoryItemRow({ item, depth, onEdit, onDelete }: CategoryItemRowProps) {
  return (
    <>
      <div
        className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-surface-hover transition-colors"
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <div className="flex items-center gap-2 text-sm text-text-primary">
          {depth > 0 && <ChevronRight size={12} className="text-text-secondary shrink-0" />}
          {item.name}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
            title="수정"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="p-1 rounded text-text-secondary hover:text-error-text hover:bg-error-bg transition-colors"
            title="삭제"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {item.children?.map((child) => (
        <CategoryItemRow
          key={child.id}
          item={child}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

// -----------------------------------------------------------------------
// 분류 체계 서브섹션
// -----------------------------------------------------------------------
interface CategorySectionProps {
  tenantSlug: string;
  urlKey: string; // 'symptom-categories' | 'cause-categories'
  queryKey: string;
  title: string;
}

function CategorySection({ tenantSlug, urlKey, queryKey, title }: CategorySectionProps) {
  const queryClient = useQueryClient();
  const [addName, setAddName] = useState('');
  const [addParentId, setAddParentId] = useState('');
  const [editItem, setEditItem] = useState<SymptomCategoryItem | null>(null);
  const [editName, setEditName] = useState('');

  const { data, isLoading } = useQuery<SymptomCategoryItem[]>({
    queryKey: [queryKey, tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/${urlKey}`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const addMutation = useMutation({
    mutationFn: (body: { name: string; parent_id?: string }) =>
      api.post(`/${tenantSlug}/${urlKey}`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('카테고리가 추가되었습니다.');
      setAddName('');
      setAddParentId('');
      queryClient.invalidateQueries({ queryKey: [queryKey, tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/${tenantSlug}/${urlKey}/${id}`, { name }).then((r) => r.data),
    onSuccess: () => {
      toast.success('카테고리가 수정되었습니다.');
      setEditItem(null);
      queryClient.invalidateQueries({ queryKey: [queryKey, tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/${tenantSlug}/${urlKey}/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('카테고리가 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: [queryKey, tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 트리를 평탄화 — 부모 선택 드롭다운용
  function flattenTree(items: SymptomCategoryItem[], depth = 0): { id: string; name: string; depth: number }[] {
    return items.flatMap((item) => [
      { id: item.id, name: item.name, depth },
      ...flattenTree(item.children ?? [], depth + 1),
    ]);
  }

  const items = data ?? [];
  const flatList = flattenTree(items);

  const handleEdit = (item: SymptomCategoryItem) => {
    setEditItem(item);
    setEditName(item.name);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-text-primary">{title}</p>

      {/* 추가 폼 */}
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-text-secondary">카테고리 이름</label>
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="새 카테고리"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs text-text-secondary">상위 카테고리 (선택)</label>
          <select
            value={addParentId}
            onChange={(e) => setAddParentId(e.target.value)}
            className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">최상위</option>
            {flatList.map((f) => (
              <option key={f.id} value={f.id}>
                {'  '.repeat(f.depth)}{f.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          leftIcon={<Plus size={14} />}
          isLoading={addMutation.isPending}
          onClick={() =>
            addMutation.mutate({ name: addName, ...(addParentId ? { parent_id: addParentId } : {}) })
          }
          disabled={!addName.trim()}
        >
          추가
        </Button>
      </div>

      {/* 수정 폼 */}
      {editItem && (
        <div className="flex items-end gap-2 rounded-md border border-border-default bg-surface p-3">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-text-secondary">이름 수정: {editItem.name}</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <Button
            size="sm"
            isLoading={editMutation.isPending}
            onClick={() => editMutation.mutate({ id: editItem.id, name: editName })}
            disabled={!editName.trim()}
          >
            저장
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditItem(null)}>
            취소
          </Button>
        </div>
      )}

      {/* 트리 목록 */}
      <div className="rounded-lg border border-border-default bg-surface py-1">
        {isLoading ? (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-secondary">카테고리가 없습니다.</p>
        ) : (
          items.map((item) => (
            <CategoryItemRow
              key={item.id}
              item={item}
              depth={0}
              onEdit={handleEdit}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CategoriesTab({ tenantSlug }: { tenantSlug: string }) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-text-secondary">
        티켓에서 사용할 증상 분류와 원인 분류 체계를 관리합니다.
      </p>
      <CategorySection
        tenantSlug={tenantSlug}
        urlKey="symptom-categories"
        queryKey="symptom-categories"
        title="증상 분류"
      />
      <CategorySection
        tenantSlug={tenantSlug}
        urlKey="cause-categories"
        queryKey="cause-categories"
        title="원인 분류"
      />
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 5: 지원팀 관리
// -----------------------------------------------------------------------
function SupportTeamsTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', level: 1, description: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', level: 1, description: '' });

  const { data, isLoading } = useQuery<SupportTeam[]>({
    queryKey: ['support-teams', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/support-teams`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; level: number; description?: string }) =>
      api.post(`/${tenantSlug}/support-teams`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('지원팀이 생성되었습니다.');
      setShowAddForm(false);
      setAddForm({ name: '', level: 1, description: '' });
      queryClient.invalidateQueries({ queryKey: ['support-teams', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name: string; level: number; description?: string } }) =>
      api.patch(`/${tenantSlug}/support-teams/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('지원팀이 수정되었습니다.');
      setEditId(null);
      queryClient.invalidateQueries({ queryKey: ['support-teams', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/${tenantSlug}/support-teams/${id}`, { is_active: !is_active }).then((r) => r.data),
    onSuccess: () => {
      toast.success('팀 상태가 변경되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['support-teams', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const teams = data ?? [];

  const LEVEL_LABELS: Record<number, string> = { 1: 'L1', 2: 'L2', 3: 'L3' };
  const LEVEL_COLORS: Record<number, string> = {
    1: 'bg-blue-100 text-blue-700',
    2: 'bg-purple-100 text-purple-700',
    3: 'bg-red-100 text-red-700',
  };

  const handleEditOpen = (team: SupportTeam) => {
    setEditId(team.id);
    setEditForm({ name: team.name, level: team.level, description: team.description ?? '' });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">에스컬레이션 레벨별 지원팀을 관리합니다.</p>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowAddForm((v) => !v)}>
          팀 추가
        </Button>
      </div>

      {/* 추가 폼 */}
      {showAddForm && (
        <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-text-primary">새 지원팀</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">팀 이름 *</label>
              <input
                type="text"
                value={addForm.name}
                onChange={(e) => setAddForm((v) => ({ ...v, name: e.target.value }))}
                className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="1차 지원팀"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">레벨</label>
              <div className="flex gap-3 items-center h-[38px]">
                {([1, 2, 3] as const).map((lv) => (
                  <label key={lv} className="flex items-center gap-1 cursor-pointer text-sm text-text-primary">
                    <input
                      type="radio"
                      name="add-level"
                      value={lv}
                      checked={addForm.level === lv}
                      onChange={() => setAddForm((v) => ({ ...v, level: lv }))}
                      className="accent-accent"
                    />
                    {LEVEL_LABELS[lv]}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">설명 (선택)</label>
            <input
              type="text"
              value={addForm.description}
              onChange={(e) => setAddForm((v) => ({ ...v, description: e.target.value }))}
              className="rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="팀 역할 간단 설명"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
              취소
            </Button>
            <Button
              size="sm"
              isLoading={createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  name: addForm.name,
                  level: addForm.level,
                  ...(addForm.description ? { description: addForm.description } : {}),
                })
              }
              disabled={!addForm.name.trim()}
            >
              생성
            </Button>
          </div>
        </div>
      )}

      {/* 팀 목록 */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg border border-border-default bg-surface py-12 text-center text-sm text-text-secondary">
          지원팀이 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {teams.map((team) => (
            <div
              key={team.id}
              className={cn(
                'rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-2',
                !team.is_active && 'opacity-60',
              )}
            >
              {editId === team.id ? (
                /* 인라인 편집 폼 */
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))}
                    className="rounded-md border border-border-default bg-bg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex gap-3">
                    {([1, 2, 3] as const).map((lv) => (
                      <label key={lv} className="flex items-center gap-1 cursor-pointer text-xs text-text-primary">
                        <input
                          type="radio"
                          name={`edit-level-${team.id}`}
                          value={lv}
                          checked={editForm.level === lv}
                          onChange={() => setEditForm((v) => ({ ...v, level: lv }))}
                          className="accent-accent"
                        />
                        {LEVEL_LABELS[lv]}
                      </label>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={(e) => setEditForm((v) => ({ ...v, description: e.target.value }))}
                    className="rounded-md border border-border-default bg-bg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="설명"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>
                      취소
                    </Button>
                    <Button
                      size="sm"
                      isLoading={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({
                          id: team.id,
                          body: {
                            name: editForm.name,
                            level: editForm.level,
                            ...(editForm.description ? { description: editForm.description } : {}),
                          },
                        })
                      }
                      disabled={!editForm.name.trim()}
                    >
                      저장
                    </Button>
                  </div>
                </div>
              ) : (
                /* 카드 뷰 */
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold',
                          LEVEL_COLORS[team.level] ?? 'bg-gray-100 text-gray-600',
                        )}
                      >
                        {LEVEL_LABELS[team.level] ?? `L${team.level}`}
                      </span>
                      <span className="text-sm font-medium text-text-primary">{team.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleEditOpen(team)}
                        className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                        title="수정"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActiveMutation.mutate({ id: team.id, is_active: team.is_active })}
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors ml-1',
                          team.is_active
                            ? 'bg-success-bg text-success-text hover:bg-error-bg hover:text-error-text'
                            : 'bg-error-bg text-error-text hover:bg-success-bg hover:text-success-text',
                        )}
                      >
                        {team.is_active ? '활성' : '비활성'}
                      </button>
                    </div>
                  </div>
                  {team.description && (
                    <p className="text-xs text-text-secondary">{team.description}</p>
                  )}
                  <p className="text-xs text-text-secondary">멤버 {team.member_count}명</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 6: 외부 알림 이력
// -----------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = {
  sent:      'bg-success-bg text-success-text',
  pending:   'bg-amber-100 text-amber-700',
  retrying:  'bg-blue-100 text-blue-700',
  failed:    'bg-error-bg text-error-text',
};

function ExtNotifHistoryTab({ tenantSlug }: { tenantSlug: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading } = useQuery<{ items: ExtNotifLog[]; total: number }>({
    queryKey: ['ext-notif-history', tenantSlug, page],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/notifications/external`, { params: { page, page_size: pageSize } })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (val: string | null) => {
    if (!val) return '-';
    return new Date(val).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        고객에게 발송된 외부 알림(이메일·SMS·카카오 등) 이력을 확인합니다.
      </p>

      <div className="overflow-auto rounded-lg border border-border-default">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">티켓</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">채널</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이벤트</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">수신자</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">발송일시</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">재시도</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">오류</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <RowSkeletons cols={8} />
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-text-secondary">
                  알림 이력이 없습니다.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-border-subtle hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-3 text-xs text-text-secondary font-mono">
                    {log.ticket_id ? log.ticket_id.slice(0, 8) : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-text-primary font-medium">{log.channel}</td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{log.event_type}</td>
                  <td className="px-4 py-3 text-xs text-text-secondary truncate max-w-[140px]">{log.recipient}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        STATUS_COLORS[log.status] ?? 'bg-surface text-text-secondary',
                      )}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{formatDate(log.sent_at)}</td>
                  <td className="px-4 py-3 text-xs text-text-secondary text-center">{log.retry_count}</td>
                  <td className="px-4 py-3 text-xs text-error-text max-w-[160px]">
                    {log.error_msg ? (
                      <span title={log.error_msg} className="truncate block cursor-help">
                        {log.error_msg}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            이전
          </Button>
          <span className="text-xs text-text-secondary">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// EmailInboundTab — IMAP 수신 설정 (ONB-3)
// -----------------------------------------------------------------------
interface EmailInboundConfig {
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password: string;
  imap_folder: string;
  is_active: boolean;
  last_checked_at: string | null;
  last_error: string | null;
}

function EmailInboundTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    imap_host: '',
    imap_port: 993,
    imap_user: '',
    imap_password: '',
    imap_folder: 'INBOX',
    is_active: true,
  });
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const { data: config, isLoading } = useQuery<EmailInboundConfig | null>({
    queryKey: ['email-inbound-config', tenantSlug],
    queryFn: async () => {
      try {
        const res = await api.get<EmailInboundConfig>(`/${tenantSlug}/settings/email-inbound`);
        return res.data ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!tenantSlug,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (config) {
      setForm({
        imap_host: config.imap_host,
        imap_port: config.imap_port,
        imap_user: config.imap_user,
        imap_password: config.imap_password, // "***" 마스크
        imap_folder: config.imap_folder,
        is_active: config.is_active,
      });
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/${tenantSlug}/settings/email-inbound`, form).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-inbound-config', tenantSlug] });
      toast.success('IMAP 설정이 저장되었습니다.');
      setTestResult(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/${tenantSlug}/settings/email-inbound/test`,
        form,
      );
      setTestResult(res.data);
      if (res.data.ok) {
        toast.success(res.data.message);
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const inputCls = 'h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500';

  return (
    <div className="max-w-lg flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-text-primary">이메일 수신 (IMAP)</h2>
        <p className="mt-1 text-sm text-text-secondary">
          IMAP 메일함을 연결하면 수신된 이메일이 자동으로 티켓으로 생성됩니다.
        </p>
      </div>

      {/* 상태 표시 */}
      {config?.last_checked_at && (
        <div className={cn(
          'rounded-lg border px-4 py-3 text-sm',
          config.last_error
            ? 'border-error/30 bg-error/5 text-error-text'
            : 'border-success/30 bg-success/5 text-success',
        )}>
          <p className="font-medium">
            {config.last_error ? '마지막 수신 오류' : '정상 동작 중'}
          </p>
          {config.last_error && (
            <p className="mt-0.5 text-xs opacity-80">{config.last_error}</p>
          )}
          <p className="mt-0.5 text-xs opacity-70">
            마지막 확인: {new Date(config.last_checked_at).toLocaleString('ko-KR')}
          </p>
        </div>
      )}

      {/* 폼 */}
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-primary">IMAP 서버 *</label>
            <input
              type="text"
              value={form.imap_host}
              onChange={(e) => setForm((f) => ({ ...f, imap_host: e.target.value }))}
              placeholder="imap.gmail.com"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-primary">포트</label>
            <input
              type="number"
              value={form.imap_port}
              onChange={(e) => setForm((f) => ({ ...f, imap_port: Number(e.target.value) }))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-primary">이메일 계정 *</label>
          <input
            type="email"
            value={form.imap_user}
            onChange={(e) => setForm((f) => ({ ...f, imap_user: e.target.value }))}
            placeholder="support@yourcompany.com"
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-primary">비밀번호 *</label>
          <input
            type="password"
            value={form.imap_password}
            onChange={(e) => setForm((f) => ({ ...f, imap_password: e.target.value }))}
            placeholder={config ? '변경 시에만 입력' : '앱 비밀번호 입력'}
            className={inputCls}
          />
          {config && (
            <p className="text-xs text-text-secondary">변경하지 않으면 기존 비밀번호가 유지됩니다.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-primary">폴더</label>
          <input
            type="text"
            value={form.imap_folder}
            onChange={(e) => setForm((f) => ({ ...f, imap_folder: e.target.value }))}
            placeholder="INBOX"
            className={inputCls}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={form.is_active}
            onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
              form.is_active ? 'bg-[#F5C000]' : 'bg-border-default',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                form.is_active ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
          <span className="text-sm text-text-primary">수신 활성화</span>
        </div>
      </div>

      {/* 연결 테스트 결과 */}
      {testResult && (
        <div className={cn(
          'rounded-lg border px-4 py-3 text-sm',
          testResult.ok
            ? 'border-success/30 bg-success/5 text-success'
            : 'border-error/30 bg-error/5 text-error-text',
        )}>
          {testResult.message}
        </div>
      )}

      {/* 버튼 */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={handleTest}
          isLoading={isTesting}
          disabled={!form.imap_host || !form.imap_user}
        >
          연결 테스트
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          isLoading={saveMutation.isPending}
          disabled={!form.imap_host || !form.imap_user}
        >
          저장
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 8: API 키 관리
// -----------------------------------------------------------------------
interface ApiKeyItem {
  id: string;
  name: string;
  created_by_name: string | null;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

function ApiKeysTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const { data: keys = [], isLoading } = useQuery<ApiKeyItem[]>({
    queryKey: ['api-keys', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/settings/api-keys`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      api.post(`/${tenantSlug}/settings/api-keys`, { name }).then((r) => r.data),
    onSuccess: (data) => {
      setCreatedKey(data.raw_key);
      setShowCreate(false);
      setNewKeyName('');
      setConfirmed(false);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['api-keys', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/${tenantSlug}/settings/api-keys/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('API 키가 비활성화되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['api-keys', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  async function handleCopy() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-primary">API 키</p>
          <p className="text-xs text-text-secondary mt-0.5">
            외부 시스템에서 ITSM API를 호출할 때 사용합니다. 키는 생성 시 1회만 표시됩니다.
          </p>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
          새 API 키
        </Button>
      </div>

      {/* 생성 폼 */}
      {showCreate && (
        <div className="rounded-lg border border-border-default bg-surface p-4 flex items-end gap-3">
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-xs text-text-secondary">키 이름</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="예: 모니터링 시스템"
              className="h-8 rounded-md border border-border-default bg-bg px-3 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <Button
            size="sm"
            disabled={!newKeyName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(newKeyName.trim())}
          >
            생성
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
            취소
          </Button>
        </div>
      )}

      {/* 생성된 키 1회 표시 모달 */}
      {createdKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Key size={14} className="text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              API 키가 생성되었습니다 — 지금 복사하세요 (이후 다시 볼 수 없습니다)
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border-default bg-bg px-3 py-2">
            <code className="flex-1 text-xs font-mono text-text-primary break-all select-all">{createdKey}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded p-1 text-text-secondary hover:text-text-primary transition-colors"
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="h-4 w-4 rounded border-border-default accent-amber-500"
            />
            <span className="text-xs text-text-secondary">키를 복사했습니다. 안전한 곳에 저장했습니다.</span>
          </label>
          <Button
            size="sm"
            disabled={!confirmed}
            onClick={() => setCreatedKey(null)}
          >
            확인
          </Button>
        </div>
      )}

      {/* 키 목록 */}
      <div className="rounded-lg border border-border-default overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-surface-elevated">
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">이름</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">마지막 사용</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">만료일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">생성일</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <RowSkeletons cols={6} />
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-tertiary">
                  등록된 API 키가 없습니다.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className={cn('border-b border-border-subtle', !k.is_active && 'opacity-50')}>
                  <td className="px-4 py-3 font-medium text-text-primary">{k.name}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', k.is_active ? 'text-success' : 'text-text-tertiary')}>
                      {k.is_active ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {k.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString('ko-KR') : '-'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {k.expires_at ? new Date(k.expires_at).toLocaleDateString('ko-KR') : '없음'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {new Date(k.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3">
                    {k.is_active && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`"${k.name}" 키를 비활성화하시겠습니까?`)) {
                            revokeMutation.mutate(k.id);
                          }
                        }}
                        className="text-xs text-error hover:underline"
                      >
                        비활성화
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 9: Webhook 관리
// -----------------------------------------------------------------------
const WEBHOOK_EVENTS = [
  { value: 'ticket.created',        label: '티켓 생성' },
  { value: 'ticket.status_changed', label: '티켓 상태 변경' },
  { value: 'ticket.assigned',       label: '티켓 담당자 배정' },
  { value: 'ticket.escalated',      label: '티켓 에스컬레이션' },
  { value: 'csat.submitted',        label: 'CSAT 제출' },
];

interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  secret: string;
  is_active: boolean;
  created_at: string;
}

interface DeliveryLog {
  id: string;
  event_type: string;
  status: string;
  http_status: number | null;
  attempt_count: number;
  delivered_at: string | null;
  created_at: string;
}

function WebhooksTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);

  const { data: webhooks = [], isLoading } = useQuery<WebhookItem[]>({
    queryKey: ['webhooks', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/settings/webhooks`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<DeliveryLog[]>({
    queryKey: ['webhook-logs', tenantSlug, expandedLogs],
    queryFn: () =>
      api.get(`/${tenantSlug}/settings/webhooks/${expandedLogs}/logs`).then((r) => r.data),
    enabled: !!expandedLogs,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post(`/${tenantSlug}/settings/webhooks`, { url: newUrl, events: newEvents }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Webhook이 등록되었습니다.');
      setShowCreate(false);
      setNewUrl('');
      setNewEvents([]);
      queryClient.invalidateQueries({ queryKey: ['webhooks', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/${tenantSlug}/settings/webhooks/${id}`, { is_active }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/${tenantSlug}/settings/webhooks/${id}`),
    onSuccess: () => {
      toast.success('Webhook이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['webhooks', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/${tenantSlug}/settings/webhooks/${id}/test`),
    onSuccess: () => toast.success('테스트 요청을 발송했습니다.'),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  async function copySecret(secret: string) {
    await navigator.clipboard.writeText(secret);
    setCopiedSecret(secret);
    setTimeout(() => setCopiedSecret(null), 2000);
  }

  function toggleEvent(ev: string) {
    setNewEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-primary">Webhook</p>
          <p className="text-xs text-text-secondary mt-0.5">
            ITSM 이벤트 발생 시 지정한 URL로 HTTP POST 요청을 전송합니다.
          </p>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
          Webhook 추가
        </Button>
      </div>

      {/* 등록 폼 */}
      {showCreate && (
        <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">URL</label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="h-8 rounded-md border border-border-default bg-bg px-3 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-secondary">이벤트 선택</label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((ev) => (
                <button
                  key={ev.value}
                  type="button"
                  onClick={() => toggleEvent(ev.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    newEvents.includes(ev.value)
                      ? 'border-brand bg-brand/10 text-amber-700 dark:text-amber-300'
                      : 'border-border-default text-text-secondary hover:border-brand',
                  )}
                >
                  {ev.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!newUrl.trim() || newEvents.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              등록
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setNewUrl(''); setNewEvents([]); }}>
              취소
            </Button>
          </div>
        </div>
      )}

      {/* Webhook 목록 */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default py-10 gap-2">
          <Webhook size={24} className="text-text-tertiary" />
          <p className="text-sm text-text-tertiary">등록된 Webhook이 없습니다.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {webhooks.map((wh) => (
            <div key={wh.id} className="rounded-lg border border-border-default bg-surface overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('h-2 w-2 rounded-full shrink-0', wh.is_active ? 'bg-success' : 'bg-text-tertiary')} />
                    <span className="text-sm font-medium text-text-primary break-all">{wh.url}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {wh.events.map((ev) => (
                      <span key={ev} className="rounded-full bg-border-subtle px-2 py-0.5 text-[11px] text-text-secondary">
                        {WEBHOOK_EVENTS.find((e) => e.value === ev)?.label ?? ev}
                      </span>
                    ))}
                  </div>
                  {/* 시크릿 */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] text-text-tertiary">Secret:</span>
                    <code className="text-[11px] font-mono text-text-secondary">{wh.secret.slice(0, 8)}…</code>
                    <button
                      type="button"
                      onClick={() => copySecret(wh.secret)}
                      className="text-text-tertiary hover:text-text-primary"
                    >
                      {copiedSecret === wh.secret ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => testMutation.mutate(wh.id)}
                    title="테스트 발송"
                    className="rounded p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                  >
                    <Zap size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMutation.mutate({ id: wh.id, is_active: !wh.is_active })}
                    title={wh.is_active ? '비활성화' : '활성화'}
                    className="rounded p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                  >
                    {wh.is_active ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedLogs(expandedLogs === wh.id ? null : wh.id)}
                    title="발송 이력"
                    className={cn('rounded p-1.5 transition-colors', expandedLogs === wh.id ? 'text-brand' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover')}
                  >
                    <History size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (confirm('이 Webhook을 삭제하시겠습니까?')) deleteMutation.mutate(wh.id); }}
                    className="rounded p-1.5 text-text-secondary hover:text-error transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* 발송 이력 (최근 10건) */}
              {expandedLogs === wh.id && (
                <div className="border-t border-border-subtle bg-surface-elevated">
                  <div className="px-4 py-2 text-xs font-medium text-text-secondary">최근 발송 이력</div>
                  {logsLoading ? (
                    <div className="px-4 py-3"><Skeleton className="h-4 w-full" /></div>
                  ) : logs.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-text-tertiary">발송 이력이 없습니다.</p>
                  ) : (
                    <div className="divide-y divide-border-subtle">
                      {logs.map((log) => (
                        <div key={log.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                          {log.status === 'success' ? (
                            <CheckCircle2 size={12} className="text-success shrink-0" />
                          ) : (
                            <XCircle size={12} className="text-error shrink-0" />
                          )}
                          <span className="text-text-secondary w-36 shrink-0">{log.event_type}</span>
                          <span className={cn('font-medium', log.status === 'success' ? 'text-success' : 'text-error')}>
                            {log.http_status ?? '-'}
                          </span>
                          <span className="text-text-tertiary ml-auto">
                            {new Date(log.created_at).toLocaleString('ko-KR')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 10: 구독 관리 (Billing)
// -----------------------------------------------------------------------
const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};
const PLAN_COLORS: Record<string, string> = {
  free: 'bg-border-subtle text-text-secondary',
  starter: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  professional: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  enterprise: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};
const PLAN_FEATURES: Record<string, string[]> = {
  free: ['엔지니어 3명', '월 100건 티켓', 'KB·SLA 기본'],
  starter: ['엔지니어 10명', '무제한 티켓', 'KB·SLA·보고서 전체'],
  professional: ['엔지니어 30명', '무제한 티켓', 'API 키·Webhook', 'AI 티켓 분류'],
  enterprise: ['무제한', '전체 기능', 'SLA 보장·전담 지원', '맞춤 연동'],
};

function BillingTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();

  const { data: sub, isLoading } = useQuery<SubscriptionInfo>({
    queryKey: ['billing-subscription', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/billing/subscription`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const { data: invoicesData } = useQuery<{ invoices: StripeInvoice[] }>({
    queryKey: ['billing-invoices', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/billing/invoices`).then((r) => r.data),
    enabled: !!tenantSlug,
    staleTime: 5 * 60 * 1000,
  });

  const checkoutMutation = useMutation({
    mutationFn: ({ plan }: { plan: string }) =>
      api.post(`/${tenantSlug}/billing/checkout`, {
        plan,
        success_url: `${window.location.origin}/${tenantSlug}/settings?tab=billing&upgraded=1`,
        cancel_url: `${window.location.origin}/${tenantSlug}/settings?tab=billing`,
      }).then((r) => r.data),
    onSuccess: (data) => {
      if (data.checkout_url) window.open(data.checkout_url, '_blank');
      else toast.error('결제 페이지를 열 수 없습니다. Stripe 설정을 확인하세요.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const plan = sub?.plan ?? 'free';
  const invoices = invoicesData?.invoices ?? [];

  const seatPct = sub ? Math.min((sub.seat_usage / sub.seats_limit) * 100, 100) : 0;
  const ticketPct = sub?.ticket_limit_monthly
    ? Math.min((sub.ticket_usage_this_month / sub.ticket_limit_monthly) * 100, 100)
    : 0;

  const renewalStr = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString('ko-KR')
    : null;

  const daysToRenewal = renewalStr
    ? Math.ceil(
        (new Date(sub!.current_period_end!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    : null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 max-w-2xl">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* 만료 임박 경고 */}
      {daysToRenewal !== null && daysToRenewal <= 7 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20 px-4 py-3">
          <Zap size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            구독이 {daysToRenewal}일 후 만료됩니다. 갱신하지 않으면 Free 플랜으로 자동 전환됩니다.
          </p>
        </div>
      )}

      {/* 현재 플랜 카드 */}
      <div className="rounded-xl border border-border-default bg-surface p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', PLAN_COLORS[plan])}>
                {PLAN_LABELS[plan] ?? plan}
              </span>
              {renewalStr && (
                <span className="text-xs text-text-tertiary">갱신일: {renewalStr}</span>
              )}
            </div>
            <ul className="mt-3 flex flex-col gap-1">
              {(PLAN_FEATURES[plan] ?? []).map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                  <CheckCircle2 size={13} className="text-success shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          {plan !== 'enterprise' && (
            <div className="flex flex-col gap-2 shrink-0">
              {plan === 'free' && (
                <Button
                  size="sm"
                  onClick={() => checkoutMutation.mutate({ plan: 'starter' })}
                  isLoading={checkoutMutation.isPending}
                >
                  Starter로 업그레이드
                </Button>
              )}
              {plan === 'starter' && (
                <Button
                  size="sm"
                  onClick={() => checkoutMutation.mutate({ plan: 'professional' })}
                  isLoading={checkoutMutation.isPending}
                >
                  Professional로 업그레이드
                </Button>
              )}
              {plan === 'professional' && (
                <Button size="sm" variant="outline" onClick={() => toast.info('영업팀에 문의하세요: sales@hivework.io')}>
                  Enterprise 문의
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 사용량 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 시트 */}
        <div className="rounded-lg border border-border-default bg-surface p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-secondary">엔지니어 시트</span>
            <span className="text-xs text-text-tertiary">
              {sub?.seat_usage ?? 0} / {sub?.seats_limit ?? 3}
            </span>
          </div>
          <div className="h-2 rounded-full bg-border-subtle overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', seatPct >= 90 ? 'bg-error' : seatPct >= 70 ? 'bg-amber-400' : 'bg-success')}
              style={{ width: `${seatPct}%` }}
            />
          </div>
        </div>

        {/* 티켓 (Free만) */}
        <div className="rounded-lg border border-border-default bg-surface p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-secondary">이번달 티켓</span>
            <span className="text-xs text-text-tertiary">
              {sub?.ticket_usage_this_month ?? 0}
              {sub?.ticket_limit_monthly ? ` / ${sub.ticket_limit_monthly}` : ' / 무제한'}
            </span>
          </div>
          <div className="h-2 rounded-full bg-border-subtle overflow-hidden">
            {sub?.ticket_limit_monthly ? (
              <div
                className={cn('h-full rounded-full transition-all', ticketPct >= 90 ? 'bg-error' : ticketPct >= 70 ? 'bg-amber-400' : 'bg-success')}
                style={{ width: `${ticketPct}%` }}
              />
            ) : (
              <div className="h-full w-full bg-success/30 rounded-full" />
            )}
          </div>
        </div>
      </div>

      {/* 인보이스 */}
      {invoices.length > 0 && (
        <div className="rounded-lg border border-border-default overflow-hidden">
          <div className="px-4 py-3 bg-surface-elevated border-b border-border-subtle">
            <span className="text-xs font-medium text-text-secondary">인보이스</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="flex-1">
                  <span className="text-text-primary">
                    {(inv.amount_paid / 100).toLocaleString()}
                    {inv.currency.toUpperCase()}
                  </span>
                  <span className="ml-2 text-xs text-text-tertiary">
                    {new Date(inv.period_end * 1000).toLocaleDateString('ko-KR')}
                  </span>
                </div>
                <span className={cn('text-xs', inv.status === 'paid' ? 'text-success' : 'text-amber-500')}>
                  {inv.status}
                </span>
                {inv.invoice_pdf && (
                  <a
                    href={inv.invoice_pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand hover:underline"
                  >
                    PDF
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 11: 일반 (시간대 설정 — I18N-5)
// -----------------------------------------------------------------------
const COMMON_TIMEZONES = [
  { value: 'Asia/Seoul',      label: '한국 표준시 (KST, UTC+9)' },
  { value: 'Asia/Tokyo',      label: '일본 표준시 (JST, UTC+9)' },
  { value: 'Asia/Shanghai',   label: '중국 표준시 (CST, UTC+8)' },
  { value: 'Asia/Singapore',  label: '싱가포르 표준시 (SGT, UTC+8)' },
  { value: 'UTC',             label: 'UTC' },
  { value: 'America/New_York',label: '동부 표준시 (ET, UTC-5/−4)' },
  { value: 'America/Chicago', label: '중부 표준시 (CT, UTC-6/−5)' },
  { value: 'America/Los_Angeles', label: '태평양 표준시 (PT, UTC-8/−7)' },
  { value: 'Europe/London',   label: '영국 표준시 (GMT/BST)' },
  { value: 'Europe/Berlin',   label: '중부 유럽시 (CET/CEST)' },
];

const TZ_STORAGE_KEY = 'itsm.tenant.timezone';

function GeneralTab({ tenantSlug }: { tenantSlug: string }) {
  const [tz, setTz] = useState<string>(() => {
    if (typeof window === 'undefined') return 'Asia/Seoul';
    return localStorage.getItem(`${TZ_STORAGE_KEY}.${tenantSlug}`) ?? 'Asia/Seoul';
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(`${TZ_STORAGE_KEY}.${tenantSlug}`, tz);
    setSaved(true);
    toast.success('시간대가 저장되었습니다');
    setTimeout(() => setSaved(false), 2000);
  };

  const nowInTz = new Intl.DateTimeFormat('ko-KR', {
    timeZone: tz,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="rounded-xl border border-border-default bg-surface p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Globe size={15} className="text-text-secondary" />
            시간대
          </label>
          <p className="text-xs text-text-secondary">
            티켓 생성 시각·SLA 마감·공수 타이머가 이 시간대로 표시됩니다. DB는 UTC로 저장됩니다.
          </p>
        </div>

        <select
          value={tz}
          onChange={(e) => { setTz(e.target.value); setSaved(false); }}
          className="h-10 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-500"
        >
          {COMMON_TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">
            현재 시각: <span className="font-mono">{nowInTz}</span>
          </span>
          <Button
            size="sm"
            onClick={handleSave}
            leftIcon={saved ? <CheckCircle2 size={13} className="text-success" /> : undefined}
          >
            {saved ? '저장됨' : '저장'}
          </Button>
        </div>
      </div>

      <p className="text-xs text-text-tertiary">
        * 시간대는 이 브라우저에만 적용됩니다. 팀원마다 독립적으로 설정합니다.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------
// Settings 메인 페이지
// -----------------------------------------------------------------------
export default function SettingsPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('users');

  const isAdmin = isAdminRole(user?.role as UserRole);

  // 권한 없음 처리 — hooks는 조건부 return 이전 모두 선언 완료
  if (!isAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(245, 192, 0, 0.12)' }}
        >
          <ShieldOff size={24} strokeWidth={1.5} style={{ color: '#F5C000' }} />
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary">접근 권한 없음</p>
          <p className="text-xs text-text-secondary mt-1">이 페이지는 관리자만 접근할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">설정</h1>
      </div>

      {/* 탭 헤더 */}
      <div className="flex gap-1 px-6 pt-4 border-b border-border-default bg-surface shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm rounded-t-md transition-colors border-b-2 -mb-px',
              activeTab === id
                ? 'border-accent text-text-primary font-medium'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-default',
            )}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-6">
        {activeTab === 'users' && <UsersTab tenantSlug={tenantSlug} />}
        {activeTab === 'notifications' && <NotificationsTab tenantSlug={tenantSlug} />}
        {activeTab === 'email-inbound' && <EmailInboundTab tenantSlug={tenantSlug} />}
        {activeTab === 'sla' && <SlaTab tenantSlug={tenantSlug} />}
        {activeTab === 'categories' && <CategoriesTab tenantSlug={tenantSlug} />}
        {activeTab === 'support-teams' && <SupportTeamsTab tenantSlug={tenantSlug} />}
        {activeTab === 'ext-notif-history' && <ExtNotifHistoryTab tenantSlug={tenantSlug} />}
        {activeTab === 'api-keys' && <ApiKeysTab tenantSlug={tenantSlug} />}
        {activeTab === 'webhooks' && <WebhooksTab tenantSlug={tenantSlug} />}
        {activeTab === 'billing' && <BillingTab tenantSlug={tenantSlug} />}
        {activeTab === 'general' && <GeneralTab tenantSlug={tenantSlug} />}
      </div>
    </div>
  );
}
