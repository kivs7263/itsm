'use client';

/**
 * components/catalog/DynamicForm.tsx — form_schema 기반 동적 폼 렌더러
 *
 * 지원 타입 (7종):
 *   string      → <input type="text">
 *   textarea    → <textarea>
 *   number      → <input type="number">
 *   select      → <select> 단일 선택
 *   multiselect → checkbox 그룹 다중 선택
 *   date        → <input type="date">
 *   boolean     → <input type="checkbox"> 단일
 *
 * showIf: { field, value } → 해당 field 값이 일치할 때만 렌더
 * required·pattern 클라이언트 검증 + serverErrors 머지 표시
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

// -----------------------------------------------------------------------
// 타입 정의
// -----------------------------------------------------------------------
export type FieldType =
  | 'string'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'boolean';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldValidate {
  pattern?: string;
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
}

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: FieldOption[];
  validate?: FieldValidate;
  showIf?: {
    field: string;
    value: string | boolean;
  };
}

export interface FormSchema {
  version: string;
  fields: FormField[];
}

export type FormValues = Record<string, unknown>;

interface DynamicFormProps {
  fields: FormField[];
  value: FormValues;
  onChange: (val: FormValues) => void;
  /** 서버 422 errors[].field → message 맵 */
  serverErrors?: Record<string, string>;
  /** 클라이언트 검증 결과 — 부모가 제출 시 validate() 호출 후 주입 */
  clientErrors?: Record<string, string>;
  disabled?: boolean;
}

// -----------------------------------------------------------------------
// 클라이언트 검증 헬퍼 (부모에서 호출)
// -----------------------------------------------------------------------
export function validateFields(
  fields: FormField[],
  values: FormValues,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    // showIf 조건이 있고 충족 안 되면 검증 스킵
    if (field.showIf) {
      const depVal = values[field.showIf.field];
      if (depVal !== field.showIf.value) continue;
    }

    const raw = values[field.id];

    if (field.required) {
      if (field.type === 'boolean') {
        // boolean required는 true 여야 함
        if (!raw) {
          errors[field.id] = `${field.label}은(는) 필수입니다`;
          continue;
        }
      } else if (field.type === 'multiselect') {
        if (!Array.isArray(raw) || raw.length === 0) {
          errors[field.id] = `${field.label}을(를) 하나 이상 선택해주세요`;
          continue;
        }
      } else {
        const str = raw == null ? '' : String(raw).trim();
        if (!str) {
          errors[field.id] = `${field.label}을(를) 입력해주세요`;
          continue;
        }
      }
    }

    const v = field.validate;
    if (!v) continue;

    const str = raw == null ? '' : String(raw);

    if (v.pattern && str) {
      try {
        if (!new RegExp(v.pattern).test(str)) {
          errors[field.id] = `${field.label} 형식이 올바르지 않습니다`;
          continue;
        }
      } catch {
        // 잘못된 패턴 무시
      }
    }

    if (field.type === 'string' || field.type === 'textarea') {
      if (v.min_length != null && str.length < v.min_length) {
        errors[field.id] = `최소 ${v.min_length}자 이상 입력해주세요`;
        continue;
      }
      if (v.max_length != null && str.length > v.max_length) {
        errors[field.id] = `최대 ${v.max_length}자 이하로 입력해주세요`;
        continue;
      }
    }

    if (field.type === 'number' && str) {
      const num = Number(str);
      if (v.min != null && num < v.min) {
        errors[field.id] = `${v.min} 이상의 값을 입력해주세요`;
        continue;
      }
      if (v.max != null && num > v.max) {
        errors[field.id] = `${v.max} 이하의 값을 입력해주세요`;
        continue;
      }
    }
  }

  return errors;
}

// -----------------------------------------------------------------------
// 공통 입력 스타일 헬퍼
// -----------------------------------------------------------------------
function inputCls(hasError: boolean) {
  return cn(
    'h-10 w-full rounded-md border px-3 text-sm',
    'bg-surface text-text-primary placeholder:text-text-disabled',
    'focus:outline-none focus:ring-2 focus:ring-accent-500',
    'transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed',
    hasError ? 'border-error focus:ring-error' : 'border-border-default',
  );
}

// -----------------------------------------------------------------------
// 메인 컴포넌트
// -----------------------------------------------------------------------
export function DynamicForm({
  fields,
  value,
  onChange,
  serverErrors = {},
  clientErrors = {},
  disabled = false,
}: DynamicFormProps) {
  const set = (fieldId: string, fieldVal: unknown) => {
    onChange({ ...value, [fieldId]: fieldVal });
  };

  return (
    <div className="flex flex-col gap-5">
      {fields.map((field) => {
        // showIf 조건 평가
        if (field.showIf) {
          const depVal = value[field.showIf.field];
          if (depVal !== field.showIf.value) return null;
        }

        const errorMsg = clientErrors[field.id] || serverErrors[field.id];
        const fieldVal = value[field.id];

        return (
          <div key={field.id} className="flex flex-col gap-1.5">
            {/* 라벨 (boolean 타입은 인라인 라벨 처리) */}
            {field.type !== 'boolean' && (
              <label
                htmlFor={`df-${field.id}`}
                className="text-sm font-medium text-text-primary"
              >
                {field.label}
                {field.required && (
                  <span className="ml-0.5 text-error"> *</span>
                )}
              </label>
            )}

            {/* 필드 렌더 */}
            {field.type === 'string' && (
              <input
                id={`df-${field.id}`}
                type="text"
                value={typeof fieldVal === 'string' ? fieldVal : ''}
                onChange={(e) => set(field.id, e.target.value)}
                placeholder={field.label}
                disabled={disabled}
                className={inputCls(!!errorMsg)}
              />
            )}

            {field.type === 'textarea' && (
              <textarea
                id={`df-${field.id}`}
                value={typeof fieldVal === 'string' ? fieldVal : ''}
                onChange={(e) => set(field.id, e.target.value)}
                placeholder={field.label}
                rows={4}
                disabled={disabled}
                className={cn(
                  'w-full resize-none rounded-md border px-3 py-2.5 text-sm',
                  'bg-surface text-text-primary placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-accent-500',
                  'transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed',
                  errorMsg ? 'border-error focus:ring-error' : 'border-border-default',
                )}
              />
            )}

            {field.type === 'number' && (
              <input
                id={`df-${field.id}`}
                type="number"
                value={typeof fieldVal === 'number' ? fieldVal : typeof fieldVal === 'string' ? fieldVal : ''}
                onChange={(e) =>
                  set(field.id, e.target.value === '' ? '' : Number(e.target.value))
                }
                placeholder={field.label}
                disabled={disabled}
                min={field.validate?.min}
                max={field.validate?.max}
                className={inputCls(!!errorMsg)}
              />
            )}

            {field.type === 'select' && (
              <select
                id={`df-${field.id}`}
                value={typeof fieldVal === 'string' ? fieldVal : ''}
                onChange={(e) => set(field.id, e.target.value)}
                disabled={disabled}
                className={cn(
                  inputCls(!!errorMsg),
                  'cursor-pointer',
                )}
              >
                <option value="">선택해주세요</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            {field.type === 'multiselect' && (
              <div
                className={cn(
                  'flex flex-col gap-2 rounded-md border p-3',
                  errorMsg ? 'border-error' : 'border-border-default',
                )}
              >
                {(field.options ?? []).map((opt) => {
                  const checked = Array.isArray(fieldVal)
                    ? (fieldVal as string[]).includes(opt.value)
                    : false;
                  return (
                    <Checkbox
                      key={opt.value}
                      id={`df-${field.id}-${opt.value}`}
                      label={opt.label}
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => {
                        const prev = Array.isArray(fieldVal)
                          ? (fieldVal as string[])
                          : [];
                        const next = e.target.checked
                          ? [...prev, opt.value]
                          : prev.filter((v) => v !== opt.value);
                        set(field.id, next);
                      }}
                    />
                  );
                })}
                {(field.options ?? []).length === 0 && (
                  <p className="text-sm text-text-disabled">옵션이 없습니다</p>
                )}
              </div>
            )}

            {field.type === 'date' && (
              <input
                id={`df-${field.id}`}
                type="date"
                value={typeof fieldVal === 'string' ? fieldVal : ''}
                onChange={(e) => set(field.id, e.target.value)}
                disabled={disabled}
                className={inputCls(!!errorMsg)}
              />
            )}

            {field.type === 'boolean' && (
              <Checkbox
                id={`df-${field.id}`}
                label={`${field.label}${field.required ? ' *' : ''}`}
                checked={fieldVal === true}
                disabled={disabled}
                onChange={(e) => set(field.id, e.target.checked)}
              />
            )}

            {/* 에러 메시지 */}
            {errorMsg && (
              <p className="text-xs text-error-text">{errorMsg}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
