'use client';

/**
 * RuleModal — 자동화 룰 생성/수정 모달.
 *
 * 엔드포인트 (backend/app/automation/router.py 근거):
 * - POST   /{tenant_slug}/automation/rules        (router.py:190-228)
 * - PATCH  /{tenant_slug}/automation/rules/{id}    (router.py:246-280)
 * 요청 스키마: RuleCreate/RuleUpdate (router.py:53-72)
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { AutomationAction, AutomationCondition, AutomationRule } from '@/lib/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ConditionBuilder } from './ConditionBuilder';
import { ActionBuilder } from './ActionBuilder';
import { TRIGGER_EVENTS, TRIGGER_LABELS, normalizeActionForSubmit, validateActions } from './automationConfig';

interface SupportTeamResp {
  id: string;
  name: string;
}

interface RuleModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  rule?: AutomationRule | null;
}

function FormField({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-text-primary">
        {label}{required && <span className="ml-1 text-error-text">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

export function RuleModal({ open, onClose, tenantSlug, rule }: RuleModalProps) {
  const isEdit = !!rule;
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerEvent, setTriggerEvent] = useState<string>(TRIGGER_EVENTS[0]);
  const [conditions, setConditions] = useState<AutomationCondition[]>([]);
  const [actions, setActions] = useState<AutomationAction[]>([]);
  const [priority, setPriority] = useState(0);
  const [runLimit, setRunLimit] = useState<string>('100');
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setDescription(rule.description ?? '');
      setTriggerEvent(rule.trigger_event);
      setConditions(rule.conditions ?? []);
      setActions(rule.actions ?? []);
      setPriority(rule.priority);
      setRunLimit(rule.run_limit_per_hour != null ? String(rule.run_limit_per_hour) : '');
      setEnabled(rule.enabled);
    } else {
      setName('');
      setDescription('');
      setTriggerEvent(TRIGGER_EVENTS[0]);
      setConditions([]);
      setActions([]);
      setPriority(0);
      setRunLimit('100');
      setEnabled(true);
    }
  }, [open, rule]);

  // 에스컬레이션 액션의 지원팀 선택용 — get_current_user 권한이면 접근 가능 (escalations.py:303)
  const { data: supportTeamsData } = useQuery<SupportTeamResp[]>({
    queryKey: ['automation-support-teams', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/support-teams`).then((r) => r.data),
    enabled: open && !!tenantSlug,
  });
  const supportTeams = Array.isArray(supportTeamsData) ? supportTeamsData : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('룰 이름을 입력해주세요.');
      return;
    }
    const actionsValidationError = validateActions(actions);
    if (actionsValidationError) {
      toast.error(actionsValidationError);
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      trigger_event: triggerEvent,
      conditions,
      actions: actions.map(normalizeActionForSubmit),
      priority,
      run_limit_per_hour: runLimit.trim() === '' ? null : Number(runLimit),
      enabled,
    };

    setSubmitting(true);
    try {
      if (isEdit && rule) {
        await api.patch(`/${tenantSlug}/automation/rules/${rule.id}`, payload);
        toast.success('자동화 룰이 수정되었습니다.');
      } else {
        await api.post(`/${tenantSlug}/automation/rules`, payload);
        toast.success('자동화 룰이 생성되었습니다.');
      }
      queryClient.invalidateQueries({ queryKey: ['automation-rules', tenantSlug] });
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '자동화 룰 수정' : '자동화 룰 생성'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 pb-2">
          <FormField label="룰 이름" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="예: SLA 위반 경고 시 인박스 알림"
              className="w-full h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </FormField>

          <FormField label="설명">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="이 룰의 목적을 간단히 설명하세요 (선택)"
              className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
          </FormField>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="트리거 이벤트" required>
              <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_EVENTS.map((t) => (
                    <SelectItem key={t} value={t}>{TRIGGER_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="우선순위" hint="숫자가 클수록 먼저 실행">
              <input
                type="number"
                min={0}
                max={10000}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>

            <FormField label="시간당 실행 제한" hint="비우면 무제한">
              <input
                type="number"
                min={1}
                value={runLimit}
                onChange={(e) => setRunLimit(e.target.value)}
                placeholder="100"
                className="w-full h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 '
                + (enabled ? 'bg-brand' : 'bg-border-default')
              }
            >
              <span
                className={
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 '
                  + (enabled ? 'translate-x-4' : 'translate-x-0')
                }
              />
            </button>
            <span className="text-sm text-text-primary">즉시 활성화</span>
          </div>

          <div>
            <p className="text-sm font-medium text-text-primary mb-2">조건</p>
            <ConditionBuilder value={conditions} onChange={setConditions} triggerEvent={triggerEvent} />
          </div>

          <div>
            <p className="text-sm font-medium text-text-primary mb-2">
              액션<span className="ml-1 text-error-text">*</span>
            </p>
            <ActionBuilder value={actions} onChange={setActions} supportTeams={supportTeams} />
          </div>

          <DialogFooter className="px-0">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" isLoading={submitting}>
              {isEdit ? '저장' : '생성'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
