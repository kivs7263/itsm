'use client';

/**
 * components/catalog/ApprovalPolicyEditor.tsx — approval_policy 다단/조건부 결재선 편집기
 *
 * 스키마 근거: backend/app/services/catalog_approval.py L1-44
 *   { required: bool, steps?: [{ order, approvers[], line_type, condition? }] }
 * 조건 평가 지원 연산자: >= > <= < == != (동 파일 L52 _SUPPORTED_OPS)
 *
 * required=false 또는 steps 없음 → v1 하위호환(결재 없는 draft).
 * required=true + steps → v2 다단/조건부 결재선.
 */

import React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  APPROVAL_OPS,
  APPROVAL_LINE_TYPES,
  type ApprovalPolicy,
  type ApprovalStep,
  type ApprovalOp,
} from '@/components/catalog/catalogTypes';

interface ApprovalPolicyEditorProps {
  value: ApprovalPolicy;
  onChange: (value: ApprovalPolicy) => void;
  disabled?: boolean;
}

function inputCls(hasError?: boolean) {
  return cn(
    'h-9 w-full rounded-md border px-2.5 text-sm',
    'bg-surface text-text-primary placeholder:text-text-disabled',
    'focus:outline-none focus:ring-2 focus:ring-accent-500',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    hasError ? 'border-error' : 'border-border-default',
  );
}

function newStep(order: number): ApprovalStep {
  return { order, approvers: [], line_type: 'approver', condition: null };
}

export function ApprovalPolicyEditor({ value, onChange, disabled }: ApprovalPolicyEditorProps) {
  const steps = value.steps ?? [];

  function setRequired(required: boolean) {
    onChange({ ...value, required });
  }

  function setSteps(next: ApprovalStep[]) {
    onChange({ ...value, steps: next });
  }

  function updateStep(idx: number, patch: Partial<ApprovalStep>) {
    setSteps(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function addStep() {
    setSteps([...steps, newStep(steps.length + 1)]);
  }

  function removeStep(idx: number) {
    setSteps(steps.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[idx], next[target]] = [next[target], next[idx]];
    setSteps(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <Checkbox
        id="approval-required"
        label="이 오퍼링은 결재가 필요합니다 (required)"
        checked={value.required}
        disabled={disabled}
        onChange={(e) => setRequired(e.target.checked)}
      />

      {!value.required && (
        <p className="text-xs text-text-secondary">
          결재 없이 바로 처리됩니다. 다단/조건부 결재선을 설정하려면 위 체크박스를 켜세요.
        </p>
      )}

      {value.required && (
        <div className="flex flex-col gap-3">
          {steps.length === 0 && (
            <p className="text-xs text-text-secondary">
              결재 단계가 없으면 required만 적용된 단일 승인으로 처리됩니다.
              다단 결재선을 구성하려면 아래에서 단계를 추가하세요.
            </p>
          )}

          {steps.map((step, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-3 rounded-md border border-border-default p-3"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                  <GitBranch size={12} />
                  {idx + 1}단계 (order {step.order})
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || idx === 0}
                    onClick={() => moveStep(idx, -1)}
                    title="위로"
                  >
                    <ChevronUp size={13} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || idx === steps.length - 1}
                    onClick={() => moveStep(idx, 1)}
                    title="아래로"
                  >
                    <ChevronDown size={13} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() => removeStep(idx)}
                    title="단계 삭제"
                  >
                    <Trash2 size={13} className="text-error" />
                  </Button>
                </div>
              </div>

              {/* 승인자 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary">
                  승인자 이메일 (쉼표로 구분, 여러 명이면 같은 단계에서 순서대로 삽입)
                </label>
                <input
                  type="text"
                  className={inputCls()}
                  placeholder="user1@example.com, user2@example.com"
                  value={step.approvers.join(', ')}
                  disabled={disabled}
                  onChange={(e) =>
                    updateStep(idx, {
                      approvers: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>

              {/* 라인 타입 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary">결재선 유형</label>
                <Select
                  value={step.line_type}
                  disabled={disabled}
                  onValueChange={(v) =>
                    updateStep(idx, { line_type: v as ApprovalStep['line_type'] })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPROVAL_LINE_TYPES.map((lt) => (
                      <SelectItem key={lt.value} value={lt.value}>
                        {lt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 조건 */}
              <Checkbox
                id={`approval-cond-${idx}`}
                label="조건부 단계 (form_data 필드 값 비교로 포함 여부 결정)"
                checked={!!step.condition}
                disabled={disabled}
                onChange={(e) =>
                  updateStep(idx, {
                    condition: e.target.checked
                      ? { field: '', op: '>=', value: '' }
                      : null,
                  })
                }
              />

              {step.condition && (
                <div className="grid grid-cols-3 gap-2 pl-1">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">필드 (form_data key)</label>
                    <input
                      type="text"
                      className={inputCls()}
                      placeholder="amount"
                      value={step.condition.field}
                      disabled={disabled}
                      onChange={(e) =>
                        updateStep(idx, {
                          condition: { ...step.condition!, field: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">연산자</label>
                    <Select
                      value={step.condition.op}
                      disabled={disabled}
                      onValueChange={(v) =>
                        updateStep(idx, {
                          condition: { ...step.condition!, op: v as ApprovalOp },
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPROVAL_OPS.map((op) => (
                          <SelectItem key={op.value} value={op.value}>
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">비교값</label>
                    <input
                      type="text"
                      className={inputCls()}
                      placeholder="1000000"
                      value={String(step.condition.value ?? '')}
                      disabled={disabled}
                      onChange={(e) =>
                        updateStep(idx, {
                          condition: { ...step.condition!, value: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<Plus size={13} />}
            disabled={disabled}
            onClick={addStep}
          >
            결재 단계 추가
          </Button>
        </div>
      )}
    </div>
  );
}
