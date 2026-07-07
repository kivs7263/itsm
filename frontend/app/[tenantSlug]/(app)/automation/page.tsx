'use client';

/**
 * /automation — 자동화 룰 엔진 관리 페이지 (RX-3a).
 *
 * 네비게이션: /settings '셋업' 그룹(admin 전용) 진입 — 2026-07-07 사이드바 serviceMgmt에서 축출.
 * 권한: admin만 접근·CRUD (backend router.py require_roles(admin)와 일치, 2026-07-07 admin 전용화).
 *
 * 엔드포인트 (backend/app/automation/router.py 근거):
 * - GET    /{tenant_slug}/automation/rules              (router.py:168-187)
 * - PATCH  /{tenant_slug}/automation/rules/{id}/toggle   (router.py:299-315)
 * - DELETE /{tenant_slug}/automation/rules/{id}          (router.py:283-296)
 * - GET    /{tenant_slug}/automation/runs                (router.py:323-343)
 */

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ChevronDown, ChevronRight, Pencil, Plus, RefreshCw,
  ShieldOff, Trash2, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { isAdminRole, type UserRole } from '@/lib/auth';
import type { AutomationRule, AutomationRun } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RuleModal } from '@/components/automation/RuleModal';
import { TRIGGER_EVENTS, TRIGGER_LABELS } from '@/components/automation/automationConfig';

type AutomationTab = 'rules' | 'runs';

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active ? 'border-brand text-brand' : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------
// 탭 1: 룰 목록
// -----------------------------------------------------------------------
function RulesTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: rules, isLoading, isError, refetch } = useQuery<AutomationRule[]>({
    queryKey: ['automation-rules', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/automation/rules`).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const ruleList: AutomationRule[] = Array.isArray(rules) ? rules : [];

  function openCreate() { setEditingRule(null); setModalOpen(true); }
  function openEdit(r: AutomationRule) { setEditingRule(r); setModalOpen(true); }

  async function handleToggle(rule: AutomationRule) {
    setTogglingId(rule.id);
    try {
      await api.patch(`/${tenantSlug}/automation/rules/${rule.id}/toggle`);
      queryClient.invalidateQueries({ queryKey: ['automation-rules', tenantSlug] });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(rule: AutomationRule) {
    if (!confirm(`"${rule.name}" 룰을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    setDeletingId(rule.id);
    try {
      await api.delete(`/${tenantSlug}/automation/rules/${rule.id}`);
      toast.success('룰이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['automation-rules', tenantSlug] });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">
          트리거 이벤트 발생 시 조건을 평가해 액션을 자동 실행합니다.
        </p>
        <Button size="sm" onClick={openCreate} leftIcon={<Plus size={14} />}>룰 추가</Button>
      </div>

      <div className="rounded-lg border border-border-default bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">이름</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">트리거</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">조건</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">액션</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">우선순위</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-text-secondary">관리</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  <td className="px-5 py-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-5 w-24 rounded-full" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-10" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-10" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-8" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-5 w-12 rounded-full" /></td>
                  <td className="px-5 py-3" />
                </tr>
              ))
            ) : isError ? ( /* AS-W1 */
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center">
                  <AlertTriangle size={24} className="mx-auto mb-2 text-error-text" />
                  <p className="text-sm text-text-secondary mb-2">데이터를 불러오지 못했습니다.</p>
                  <button onClick={() => refetch()} className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium">
                    <RefreshCw size={11} /> 다시 시도
                  </button>
                </td>
              </tr>
            ) : ruleList.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-text-secondary">
                  등록된 자동화 룰이 없습니다. 룰 추가 버튼으로 생성하세요.
                </td>
              </tr>
            ) : (
              ruleList.map((rule) => (
                <tr key={rule.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-text-primary font-medium">{rule.name}</p>
                    {rule.description && <p className="text-xs text-text-secondary mt-0.5">{rule.description}</p>}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant="info">{TRIGGER_LABELS[rule.trigger_event] ?? rule.trigger_event}</Badge>
                  </td>
                  <td className="px-5 py-3 text-text-secondary">{rule.conditions?.length ?? 0}개</td>
                  <td className="px-5 py-3 text-text-secondary">{rule.actions?.length ?? 0}개</td>
                  <td className="px-5 py-3 text-text-secondary">{rule.priority}</td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      disabled={togglingId === rule.id}
                      onClick={() => handleToggle(rule)}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-50',
                        rule.enabled ? 'bg-brand' : 'bg-border-default',
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                          rule.enabled ? 'translate-x-4' : 'translate-x-0',
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button size="sm" variant="ghost" leftIcon={<Pencil size={13} />} onClick={() => openEdit(rule)}>
                        수정
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<Trash2 size={13} />}
                        disabled={deletingId === rule.id}
                        onClick={() => handleDelete(rule)}
                        className="text-error-text hover:text-error-text"
                      >
                        삭제
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <RuleModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        tenantSlug={tenantSlug}
        rule={editingRule}
      />
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 2: 실행 이력
// -----------------------------------------------------------------------
const RUN_STATUS_STYLES: Record<string, string> = {
  done: 'bg-success-bg text-success-text',
  failed: 'bg-error-bg text-error-text',
  skipped: 'bg-neutral-100 text-text-secondary',
};

function RunRow({ run }: { run: AutomationRun }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="border-b border-border-subtle last:border-0 hover:bg-surface-hover transition-colors cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-5 py-3 text-text-secondary">
          <span className="inline-flex items-center gap-1">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {TRIGGER_LABELS[run.trigger_event] ?? run.trigger_event}
          </span>
        </td>
        <td className="px-5 py-3">
          <Badge variant={run.matched ? 'success' : 'default'}>{run.matched ? '조건 일치' : '조건 불일치'}</Badge>
        </td>
        <td className="px-5 py-3">
          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', RUN_STATUS_STYLES[run.status] ?? 'text-text-secondary bg-neutral-100')}>
            {run.status}
          </span>
        </td>
        <td className="px-5 py-3 text-text-secondary text-xs">{run.actions_result?.length ?? 0}개</td>
        <td className="px-5 py-3 text-text-secondary text-xs whitespace-nowrap">
          {new Date(run.created_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border-subtle bg-surface-raised">
          <td colSpan={5} className="px-5 py-3">
            <div className="space-y-2 text-xs">
              {run.error && (
                <p className="text-error-text">오류: {run.error}</p>
              )}
              <div>
                <p className="font-medium text-text-primary mb-1">트리거 페이로드</p>
                <pre className="rounded bg-surface border border-border-subtle p-2 overflow-x-auto text-text-secondary font-mono">
                  {JSON.stringify(run.trigger_payload, null, 2)}
                </pre>
              </div>
              {run.actions_result && run.actions_result.length > 0 && (
                <div>
                  <p className="font-medium text-text-primary mb-1">액션 실행 결과</p>
                  <pre className="rounded bg-surface border border-border-subtle p-2 overflow-x-auto text-text-secondary font-mono">
                    {JSON.stringify(run.actions_result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RunsTab({ tenantSlug }: { tenantSlug: string }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [triggerFilter, setTriggerFilter] = useState('all');

  const { data: runs, isLoading, isError, refetch } = useQuery<AutomationRun[]>({
    queryKey: ['automation-runs', tenantSlug, statusFilter],
    queryFn: () =>
      api.get(`/${tenantSlug}/automation/runs`, {
        params: { limit: 100, ...(statusFilter !== 'all' ? { status: statusFilter } : {}) },
      }).then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const runList: AutomationRun[] = Array.isArray(runs) ? runs : [];
  const filtered = triggerFilter === 'all' ? runList : runList.filter((r) => r.trigger_event === triggerFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-40">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">상태 전체</SelectItem>
              <SelectItem value="done">done</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
              <SelectItem value="skipped">skipped</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Select value={triggerFilter} onValueChange={setTriggerFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">트리거 전체</SelectItem>
              {TRIGGER_EVENTS.map((t) => (
                <SelectItem key={t} value={t}>{TRIGGER_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-border-default bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">트리거</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">조건 결과</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">실행 상태</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">액션 수</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-text-secondary">발생 시각</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  <td className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-8" /></td>
                  <td className="px-5 py-3"><Skeleton className="h-4 w-36" /></td>
                </tr>
              ))
            ) : isError ? ( /* AS-W1 */
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center">
                  <AlertTriangle size={24} className="mx-auto mb-2 text-error-text" />
                  <p className="text-sm text-text-secondary mb-2">데이터를 불러오지 못했습니다.</p>
                  <button onClick={() => refetch()} className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium">
                    <RefreshCw size={11} /> 다시 시도
                  </button>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-text-secondary">
                  기록된 실행 이력이 없습니다. 룰이 발화되면 여기에 표시됩니다.
                </td>
              </tr>
            ) : (
              filtered.map((run) => <RunRow key={run.id} run={run} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 페이지
// -----------------------------------------------------------------------
export default function AutomationPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AutomationTab>('rules');

  const allowed = isAdminRole(user?.role as UserRole);

  // 권한 없음 처리 — hooks는 조건부 return 이전 모두 선언 완료
  if (!allowed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(18, 155, 142, 0.12)' }}>
          <ShieldOff size={24} strokeWidth={1.5} style={{ color: '#129B8E' }} />
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
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <Zap size={18} className="text-brand" />
        <h1 className="text-xl font-semibold text-text-primary">자동화</h1>
      </div>

      {/* 탭 바 */}
      <div className="flex border-b border-border-subtle bg-surface shrink-0 px-6">
        <TabButton label="룰 목록" active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} />
        <TabButton label="실행 이력" active={activeTab === 'runs'} onClick={() => setActiveTab('runs')} />
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'rules' && <RulesTab tenantSlug={tenantSlug} />}
        {activeTab === 'runs' && <RunsTab tenantSlug={tenantSlug} />}
      </div>
    </div>
  );
}
