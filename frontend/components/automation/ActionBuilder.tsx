'use client';

/**
 * ActionBuilder — 룰 실행 시 수행할 액션 목록 편집.
 *
 * actions(list[dict]) 각 항목은 {"type": <action_type>, "params": {...}} 형태
 * (backend/app/automation/engine.py:325-326 action.get("type")/action.get("params") 소비 근거).
 * 파라미터 필드 정의는 automationConfig.ts ACTION_SCHEMAS — actions.py Pydantic 모델 근거.
 */

import React from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ACTION_SCHEMAS, ACTION_TYPES, defaultParamsFor } from './automationConfig';
import type { AutomationAction } from '@/lib/types';

interface SupportTeamOption {
  id: string;
  name: string;
}

interface ActionBuilderProps {
  value: AutomationAction[];
  onChange: (next: AutomationAction[]) => void;
  supportTeams: SupportTeamOption[];
}

export function ActionBuilder({ value, onChange, supportTeams }: ActionBuilderProps) {
  function addAction() {
    const type = ACTION_TYPES[0];
    onChange([...value, { type, params: defaultParamsFor(type) }]);
  }

  function removeAction(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function changeType(idx: number, type: string) {
    onChange(value.map((a, i) => (i === idx ? { type, params: defaultParamsFor(type) } : a)));
  }

  function updateParam(idx: number, key: string, paramValue: unknown) {
    onChange(
      value.map((a, i) => (i === idx ? { ...a, params: { ...a.params, [key]: paramValue } } : a)),
    );
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-xs text-text-disabled py-2">등록된 액션이 없습니다. 최소 1개 이상 추가하세요.</p>
      ) : (
        value.map((action, idx) => {
          const schema = ACTION_SCHEMAS[action.type];
          return (
            <div key={idx} className="rounded-lg border border-border-default bg-surface-raised p-3 space-y-3">
              <div className="flex items-center gap-2">
                <GripVertical size={14} className="text-text-disabled shrink-0" />
                <span className="text-xs font-medium text-text-secondary shrink-0">액션 {idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <Select value={action.type} onValueChange={(v) => changeType(idx, v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{ACTION_SCHEMAS[t].label} ({t})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <button
                  type="button"
                  onClick={() => removeAction(idx)}
                  className="shrink-0 text-text-disabled hover:text-error-text transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {schema && (
                <div className="space-y-2 pl-6">
                  {schema.fields
                    .filter((f) => !f.showIf || f.showIf(action.params))
                    .map((f) => {
                      const raw = action.params[f.key];
                      if (f.type === 'checkbox') {
                        return (
                          <Checkbox
                            key={f.key}
                            id={`${idx}-${f.key}`}
                            label={f.label}
                            checked={Boolean(raw)}
                            onChange={(e) => updateParam(idx, f.key, e.target.checked)}
                          />
                        );
                      }
                      if (f.type === 'select') {
                        return (
                          <div key={f.key} className="space-y-1">
                            <label className="text-xs font-medium text-text-primary">
                              {f.label}{f.required && <span className="ml-0.5 text-error-text">*</span>}
                            </label>
                            <Select
                              value={raw !== undefined && raw !== '' ? String(raw) : (f.default ? String(f.default) : undefined)}
                              onValueChange={(v) => updateParam(idx, f.key, v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {(f.options ?? []).map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      }
                      if (f.type === 'dynamic-select' && f.dynamicSource === 'support_teams') {
                        return (
                          <div key={f.key} className="space-y-1">
                            <label className="text-xs font-medium text-text-primary">
                              {f.label}{f.required && <span className="ml-0.5 text-error-text">*</span>}
                            </label>
                            <Select
                              value={raw ? String(raw) : undefined}
                              onValueChange={(v) => updateParam(idx, f.key, v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder={supportTeams.length ? '팀 선택' : '등록된 지원팀 없음'} />
                              </SelectTrigger>
                              <SelectContent>
                                {supportTeams.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      }
                      if (f.type === 'textarea') {
                        return (
                          <div key={f.key} className="space-y-1">
                            <label className="text-xs font-medium text-text-primary">
                              {f.label}{f.required && <span className="ml-0.5 text-error-text">*</span>}
                            </label>
                            <textarea
                              value={typeof raw === 'string' ? raw : ''}
                              onChange={(e) => updateParam(idx, f.key, e.target.value)}
                              rows={3}
                              placeholder={f.placeholder}
                              className="w-full rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                            />
                            {f.hint && <p className="text-[11px] text-text-secondary">{f.hint}</p>}
                          </div>
                        );
                      }
                      // text
                      return (
                        <div key={f.key} className="space-y-1">
                          <label className="text-xs font-medium text-text-primary">
                            {f.label}{f.required && <span className="ml-0.5 text-error-text">*</span>}
                          </label>
                          <input
                            type="text"
                            value={typeof raw === 'string' ? raw : ''}
                            onChange={(e) => updateParam(idx, f.key, e.target.value)}
                            placeholder={f.placeholder}
                            className="w-full h-8 rounded-md border border-border-default bg-surface px-2.5 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                          />
                          {f.hint && <p className="text-[11px] text-text-secondary">{f.hint}</p>}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })
      )}
      <Button type="button" size="sm" variant="ghost" onClick={addAction} leftIcon={<Plus size={13} />}>
        액션 추가
      </Button>
    </div>
  );
}
