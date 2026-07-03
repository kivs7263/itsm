'use client';

/**
 * ConditionBuilder — JSONLogic 조건 배열을 필드/연산자/값 행으로 편집.
 *
 * conditions(list[Any])는 evaluator.py 기준 임의 JSONLogic 표현식이 저장될 수 있으나,
 * 이 UI는 단순 비교(`{op: [{var: field}, value]}`) 조합만 생성한다.
 * 기존 룰이 and/or 등 중첩 표현식을 담고 있으면 단순 파싱이 실패 → 고급(JSON) 모드로
 * 자동 전환해 원본을 보존한다 (임의 파싱/변형으로 조건 의미를 깨뜨리지 않기 위함).
 *
 * 조건 배열 전체는 묵시적 AND (evaluator.py evaluate_conditions).
 */

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CONDITION_OPERATORS, OPERATOR_LABELS, TRIGGER_FIELDS } from './automationConfig';
import type { AutomationCondition } from '@/lib/types';

interface SimpleRow {
  field: string;
  operator: string;
  value: string;
}

function parseRow(cond: unknown): SimpleRow | null {
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) return null;
  const entries = Object.entries(cond as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [op, args] = entries[0];
  if (!(CONDITION_OPERATORS as readonly string[]).includes(op)) return null;
  if (!Array.isArray(args) || args.length !== 2) return null;
  const [left, right] = args;
  if (!left || typeof left !== 'object' || Array.isArray(left) || typeof (left as { var?: unknown }).var !== 'string') {
    return null;
  }
  if (right !== null && typeof right === 'object') return null; // 우변은 원시값만 지원
  return { field: (left as { var: string }).var, operator: op, value: right === null ? '' : String(right) };
}

function buildCondition(row: SimpleRow): AutomationCondition {
  let value: unknown = row.value;
  if (row.value.trim() !== '' && !Number.isNaN(Number(row.value)) && /^-?\d+(\.\d+)?$/.test(row.value.trim())) {
    value = Number(row.value);
  } else if (row.value === 'true' || row.value === 'false') {
    value = row.value === 'true';
  }
  return { [row.operator]: [{ var: row.field }, value] };
}

interface ConditionBuilderProps {
  value: AutomationCondition[];
  onChange: (next: AutomationCondition[]) => void;
  triggerEvent: string;
}

export function ConditionBuilder({ value, onChange, triggerEvent }: ConditionBuilderProps) {
  // 단순 파싱 가능 여부 판정 — 하나라도 실패하면 고급 모드
  const parsedRows = value.map(parseRow);
  const allParsed = parsedRows.every((r) => r !== null);
  const [advanced, setAdvanced] = useState(!allParsed && value.length > 0);
  const [rawText, setRawText] = useState(() => JSON.stringify(value, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);

  // 외부에서 rule 전환(다른 룰 편집 진입) 시 재동기화
  useEffect(() => {
    const rows = value.map(parseRow);
    setAdvanced(!rows.every((r) => r !== null) && value.length > 0);
    setRawText(JSON.stringify(value, null, 2));
    setRawError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  const rows: SimpleRow[] = allParsed ? (parsedRows as SimpleRow[]) : [];
  const suggestedFields = TRIGGER_FIELDS[triggerEvent] ?? [];

  function updateRow(idx: number, patch: Partial<SimpleRow>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next.map(buildCondition));
  }

  function addRow() {
    const next: SimpleRow[] = [...rows, { field: suggestedFields[0] ?? '', operator: '==', value: '' }];
    onChange(next.map(buildCondition));
  }

  function removeRow(idx: number) {
    onChange(rows.filter((_, i) => i !== idx).map(buildCondition));
  }

  function applyRawText() {
    try {
      const parsed = JSON.parse(rawText || '[]');
      if (!Array.isArray(parsed)) {
        setRawError('조건은 배열이어야 합니다. 예: [{"==": [{"var": "status"}, "open"]}]');
        return;
      }
      setRawError(null);
      onChange(parsed);
    } catch {
      setRawError('유효한 JSON이 아닙니다.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">
          모든 조건이 참일 때(AND) 액션이 실행됩니다. 조건이 없으면 트리거 발생 시 무조건 실행됩니다.
        </p>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="text-xs text-brand hover:underline shrink-0 ml-3"
        >
          {advanced ? '조건 빌더로 전환' : '고급(JSON) 모드'}
        </button>
      </div>

      {advanced ? (
        <div className="space-y-1.5">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onBlur={applyRawText}
            rows={6}
            spellCheck={false}
            className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
            placeholder='[{"==": [{"var": "status"}, "open"]}]'
          />
          {rawError && (
            <p className="flex items-center gap-1 text-xs text-error-text">
              <AlertTriangle size={11} /> {rawError}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.length === 0 ? (
            <p className="text-xs text-text-disabled py-2">등록된 조건이 없습니다. (무조건 실행)</p>
          ) : (
            rows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  list={`automation-fields-${triggerEvent}`}
                  value={row.field}
                  onChange={(e) => updateRow(idx, { field: e.target.value })}
                  placeholder="필드명 (예: status)"
                  className="h-8 flex-1 min-w-0 rounded-md border border-border-default bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
                <div className="w-32 shrink-0">
                  <Select value={row.operator} onValueChange={(v) => updateRow(idx, { operator: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_OPERATORS.map((op) => (
                        <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <input
                  value={row.value}
                  onChange={(e) => updateRow(idx, { value: e.target.value })}
                  placeholder="값"
                  className="h-8 w-32 shrink-0 rounded-md border border-border-default bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="shrink-0 text-text-disabled hover:text-error-text transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
          <datalist id={`automation-fields-${triggerEvent}`}>
            {suggestedFields.map((f) => <option key={f} value={f} />)}
          </datalist>
          <Button type="button" size="sm" variant="ghost" onClick={addRow} leftIcon={<Plus size={13} />}>
            조건 추가
          </Button>
        </div>
      )}
    </div>
  );
}
