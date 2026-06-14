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
type TabId = 'users' | 'notifications' | 'sla' | 'categories';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'users',         label: '사용자 관리',  icon: Users },
  { id: 'notifications', label: '알림 채널',    icon: Bell  },
  { id: 'sla',           label: 'SLA 정책',     icon: Clock },
  { id: 'categories',    label: '분류 체계',    icon: Tag   },
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
    mutationFn: (body: Partial<NotificationConfig>) =>
      api.put(`/${tenantSlug}/notifications/config`, body).then((r) => r.data),
    onSuccess: () => {
      toast.success('채널 설정이 저장되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['notif-config', tenantSlug] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleChange = (key: keyof NotificationConfig, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value || null }));
  };

  const handleSave = () => {
    saveMutation.mutate(draft);
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
        {activeTab === 'sla' && <SlaTab tenantSlug={tenantSlug} />}
        {activeTab === 'categories' && <CategoriesTab tenantSlug={tenantSlug} />}
      </div>
    </div>
  );
}
