'use client';

/**
 * components/catalog/FormSchemaEditor.tsx — form_schema.fields 편집기
 *
 * 스키마 근거: backend/app/services/catalog_form.py L1-27
 *   { version, fields: [{ id, label, type, required, options?, validate?: { pattern } }] }
 * 지원 타입 7종(동 파일 L18-19): string/textarea/number/select/multiselect/date/boolean
 *
 * 렌더러(components/catalog/DynamicForm.tsx)와 동일한 FormField 타입을 재사용해
 * 편집기에서 만든 스키마가 그대로 포털 렌더러에서 소비 가능하도록 보장.
 */

import React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
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
import type { FormField } from '@/components/catalog/DynamicForm';
import { FIELD_TYPE_OPTIONS, type ServiceFormSchema } from '@/components/catalog/catalogTypes';

interface FormSchemaEditorProps {
  value: ServiceFormSchema;
  onChange: (value: ServiceFormSchema) => void;
  disabled?: boolean;
}

function inputCls() {
  return cn(
    'h-9 w-full rounded-md border border-border-default px-2.5 text-sm',
    'bg-surface text-text-primary placeholder:text-text-disabled',
    'focus:outline-none focus:ring-2 focus:ring-accent-500',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  );
}

function newField(idx: number): FormField {
  return {
    id: `field_${idx + 1}`,
    label: '새 필드',
    type: 'string',
    required: false,
  };
}

const OPTION_TYPES: FormField['type'][] = ['select', 'multiselect'];

/** options 배열 <-> "value:label" 줄바꿈 텍스트 상호 변환 */
function optionsToText(options?: { value: string; label: string }[]): string {
  return (options ?? []).map((o) => `${o.value}:${o.label}`).join('\n');
}
function textToOptions(text: string): { value: string; label: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return { value: line, label: line };
      return { value: line.slice(0, idx).trim(), label: line.slice(idx + 1).trim() };
    });
}

export function FormSchemaEditor({ value, onChange, disabled }: FormSchemaEditorProps) {
  const fields = value.fields ?? [];

  function setFields(next: FormField[]) {
    onChange({ ...value, fields: next });
  }

  function updateField(idx: number, patch: Partial<FormField>) {
    setFields(fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  function addField() {
    setFields([...fields, newField(fields.length)]);
  }

  function removeField(idx: number) {
    setFields(fields.filter((_, i) => i !== idx));
  }

  function moveField(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[idx], next[target]] = [next[target], next[idx]];
    setFields(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 && (
        <p className="text-xs text-text-secondary">
          신청 폼 필드가 없습니다. 필드를 추가하면 포털에서 해당 항목 신청 시 이 폼이 표시됩니다.
        </p>
      )}

      {fields.map((field, idx) => {
        const showOptions = OPTION_TYPES.includes(field.type);
        return (
          <div
            key={idx}
            className="flex flex-col gap-3 rounded-md border border-border-default p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">
                {idx + 1}번 필드
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled || idx === 0}
                  onClick={() => moveField(idx, -1)}
                  title="위로"
                >
                  <ChevronUp size={13} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled || idx === fields.length - 1}
                  onClick={() => moveField(idx, 1)}
                  title="아래로"
                >
                  <ChevronDown size={13} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  onClick={() => removeField(idx)}
                  title="필드 삭제"
                >
                  <Trash2 size={13} className="text-error" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">필드 ID (form_data key)</label>
                <input
                  type="text"
                  className={inputCls()}
                  value={field.id}
                  disabled={disabled}
                  onChange={(e) => updateField(idx, { id: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">라벨</label>
                <input
                  type="text"
                  className={inputCls()}
                  value={field.label}
                  disabled={disabled}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">타입</label>
                <Select
                  value={field.type}
                  disabled={disabled}
                  onValueChange={(v) => updateField(idx, { type: v as FormField['type'] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Checkbox
                id={`fs-required-${idx}`}
                label="필수 입력"
                checked={field.required}
                disabled={disabled}
                onChange={(e) => updateField(idx, { required: e.target.checked })}
              />
            </div>

            {showOptions && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">
                  선택 옵션 — 한 줄에 하나, &quot;값:라벨&quot; 형식 (예: gold:골드)
                </label>
                <textarea
                  rows={3}
                  className={cn(inputCls(), 'h-auto resize-none py-2')}
                  value={optionsToText(field.options)}
                  disabled={disabled}
                  onChange={(e) => updateField(idx, { options: textToOptions(e.target.value) })}
                />
              </div>
            )}

            {(field.type === 'string' || field.type === 'textarea') && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">
                  검증 정규식 (validate.pattern, 선택)
                </label>
                <input
                  type="text"
                  className={inputCls()}
                  placeholder="^[A-Za-z0-9]+$"
                  value={field.validate?.pattern ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    updateField(idx, {
                      validate: e.target.value
                        ? { ...field.validate, pattern: e.target.value }
                        : undefined,
                    })
                  }
                />
              </div>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        leftIcon={<Plus size={13} />}
        disabled={disabled}
        onClick={addField}
      >
        필드 추가
      </Button>
    </div>
  );
}
