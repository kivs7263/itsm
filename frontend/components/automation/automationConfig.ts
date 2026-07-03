/**
 * automationConfig.ts — 자동화 룰 엔진 UI 공통 설정
 *
 * 근거 (추측 금지, 백엔드 소스 대조):
 * - 트리거: backend/app/automation/router.py:45-50 SUPPORTED_TRIGGERS
 * - 트리거 payload 필드: backend/app/routers/tickets.py:588-595(created),
 *   770-777(status_changed), 797-803(assigned) /
 *   backend/app/workers/sla_worker.py:285-289(sla_breach_warning)
 * - 조건 연산자: backend/app/automation/evaluator.py:18-20 ALLOWED_OPERATORS
 *   (비교/in만 빌더 노출 — and/or/!/var/missing은 고급 모드 대상)
 * - 액션 8종 + 파라미터: backend/app/automation/actions.py 파라미터 Pydantic 모델
 */

// ---------------------------------------------------------------------------
// 트리거
// ---------------------------------------------------------------------------
export const TRIGGER_EVENTS = [
  'ticket.created',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.sla_breach_warning',
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const TRIGGER_LABELS: Record<string, string> = {
  'ticket.created': '티켓 생성',
  'ticket.status_changed': '티켓 상태 변경',
  'ticket.assigned': '담당자 배정',
  'ticket.sla_breach_warning': 'SLA 위반 경고',
};

/** 트리거별 payload 필드 — 조건 빌더의 필드명 자동완성 제안용 */
export const TRIGGER_FIELDS: Record<string, string[]> = {
  'ticket.created': ['ticket_id', 'request_type', 'priority', 'status', 'tenant_id', 'created_by'],
  'ticket.status_changed': ['ticket_id', 'prev_status', 'new_status', 'assignee_id', 'tenant_id', 'actor_id'],
  'ticket.assigned': ['ticket_id', 'assignee_id', 'prev_assignee_id', 'tenant_id', 'actor_id'],
  'ticket.sla_breach_warning': ['ticket_id', 'response_deadline', 'tenant_id'],
};

// ---------------------------------------------------------------------------
// 조건 연산자 (evaluator.py ALLOWED_OPERATORS 중 빌더 노출 대상)
// ---------------------------------------------------------------------------
export const CONDITION_OPERATORS = ['==', '!=', '<', '<=', '>', '>=', 'in'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const OPERATOR_LABELS: Record<string, string> = {
  '==': '같음 (==)',
  '!=': '다름 (!=)',
  '<': '미만 (<)',
  '<=': '이하 (<=)',
  '>': '초과 (>)',
  '>=': '이상 (>=)',
  in: '포함 (in)',
};

// ---------------------------------------------------------------------------
// 액션 파라미터 필드 정의
// ---------------------------------------------------------------------------
export interface ActionParamField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'dynamic-select';
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  /** 'support_teams' — RuleModal이 GET /support-teams 결과를 주입 */
  dynamicSource?: 'support_teams';
  default?: string | boolean;
  /** 다른 필드 값에 따라 조건부 표시 (예: recipient_type=custom일 때만 to_email) */
  showIf?: (params: Record<string, unknown>) => boolean;
}

export interface ActionSchema {
  label: string;
  fields: ActionParamField[];
}

const VALID_TICKET_STATUSES = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_RECIPIENT_TYPES = ['customer', 'assignee', 'custom'];
const VALID_ESCALATION_REASONS = [
  'technical_complexity', 'permission_lack', 'sla_breach',
  'sla_warning', 'customer_request', 'manual', 'other',
];

export const ACTION_SCHEMAS: Record<string, ActionSchema> = {
  notify_inbox: {
    label: '인박스 알림 발행',
    fields: [
      { key: 'title', label: '제목', type: 'text', required: true },
      { key: 'body', label: '본문', type: 'textarea', required: true },
      { key: 'user_id', label: '대상 사용자 UUID (미지정 시 담당자)', type: 'text', placeholder: 'UUID (선택)' },
      { key: 'event_namespace', label: '이벤트 네임스페이스', type: 'text', default: 'itsm.automation.notify', hint: '기본값: itsm.automation.notify' },
    ],
  },
  change_ticket_status: {
    label: '티켓 상태 변경',
    fields: [
      {
        key: 'status', label: '변경할 상태', type: 'select', required: true,
        options: VALID_TICKET_STATUSES.map((s) => ({ value: s, label: s })),
        default: 'in_progress',
      },
    ],
  },
  assign_ticket: {
    label: '담당자 배정',
    fields: [
      { key: 'user_id', label: '배정할 사용자 UUID', type: 'text', required: true, placeholder: 'UUID' },
    ],
  },
  create_gw_approval_draft: {
    label: 'GW 결재 기안 자동 생성',
    fields: [
      { key: 'requester_email', label: '기안자 이메일', type: 'text', required: true, placeholder: 'user@company.com' },
      { key: 'title', label: '결재 제목', type: 'text', required: true },
      { key: 'content_text', label: '결재 내용', type: 'textarea', required: true },
    ],
  },
  create_itsm_ticket: {
    label: 'ITSM 후속 티켓 자동 생성',
    fields: [
      { key: 'title', label: '티켓 제목', type: 'text', required: true },
      { key: 'description', label: '티켓 설명', type: 'textarea' },
      {
        key: 'priority', label: '우선순위', type: 'select',
        options: VALID_PRIORITIES.map((p) => ({ value: p, label: p })), default: 'medium',
      },
      { key: 'request_type', label: '유형 (incident/service_request 등)', type: 'text' },
      { key: 'source', label: '출처', type: 'text', default: 'automation', hint: '기본값: automation' },
    ],
  },
  send_email: {
    label: '이메일 발송',
    fields: [
      {
        key: 'recipient_type', label: '수신자', type: 'select', required: true,
        options: VALID_RECIPIENT_TYPES.map((r) => ({ value: r, label: r === 'customer' ? '고객' : r === 'assignee' ? '담당자' : '직접 지정' })),
        default: 'customer',
      },
      {
        key: 'to_email', label: '수신 이메일', type: 'text', placeholder: 'user@company.com',
        showIf: (p) => p.recipient_type === 'custom',
      },
      { key: 'subject', label: '제목', type: 'text', required: true },
      { key: 'message', label: '본문 (HTML 허용)', type: 'textarea', required: true },
    ],
  },
  add_comment: {
    label: '티켓 코멘트 자동 추가',
    fields: [
      { key: 'body', label: '코멘트 내용', type: 'textarea', required: true },
      { key: 'is_internal', label: '담당자 전용 내부 메모', type: 'checkbox', default: true },
    ],
  },
  escalate_ticket: {
    label: '지원팀 에스컬레이션',
    fields: [
      { key: 'to_team_id', label: '이관 대상 지원팀', type: 'dynamic-select', dynamicSource: 'support_teams', required: true },
      {
        key: 'reason', label: '에스컬레이션 사유', type: 'select', required: true,
        options: VALID_ESCALATION_REASONS.map((r) => ({ value: r, label: r })), default: 'sla_warning',
      },
      { key: 'handover_memo', label: '인계 메모 (최소 5자)', type: 'textarea', required: true },
      {
        key: 'priority', label: '우선순위 상향 (선택)', type: 'select',
        options: [{ value: 'none', label: '변경 안 함' }, { value: 'high', label: 'high' }, { value: 'critical', label: 'critical' }],
        default: 'none',
      },
      { key: 'notify_customer', label: '고객 이메일 알림 발송', type: 'checkbox', default: false },
    ],
  },
};

export const ACTION_TYPES = Object.keys(ACTION_SCHEMAS);

export function defaultParamsFor(actionType: string): Record<string, unknown> {
  const schema = ACTION_SCHEMAS[actionType];
  if (!schema) return {};
  const params: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (f.default !== undefined) params[f.key] = f.default;
    else if (f.type === 'checkbox') params[f.key] = false;
    else params[f.key] = '';
  }
  return params;
}

// ---------------------------------------------------------------------------
// 제출 전 정규화/검증 — actions.py Pydantic 파라미터 스키마와의 불일치(422) 방지
// ---------------------------------------------------------------------------

/**
 * 폼 state(모든 값 string) → 백엔드 페이로드로 정규화.
 * - 숨겨진 필드(showIf=false)는 제외
 * - 빈 문자열 optional 필드는 생략 (백엔드 Pydantic 기본값 적용)
 * - select의 'none' 센티널(예: escalate_ticket.priority 미변경)은 생략
 */
export function normalizeActionForSubmit(action: { type: string; params: Record<string, unknown> }): { type: string; params: Record<string, unknown> } {
  const schema = ACTION_SCHEMAS[action.type];
  if (!schema) return action;
  const params: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (f.showIf && !f.showIf(action.params)) continue;
    let v = action.params[f.key];
    if (f.type === 'checkbox') {
      params[f.key] = Boolean(v);
      continue;
    }
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) continue; // optional 생략 (필수 누락은 validateActions가 별도 체크)
    if (v === 'none') continue; // "변경 안 함" 센티널
    params[f.key] = v;
  }
  return { type: action.type, params };
}

/** 룰 저장 전 클라이언트 측 필수값 검증 — 첫 오류 메시지 반환(없으면 null) */
export function validateActions(actions: { type: string; params: Record<string, unknown> }[]): string | null {
  if (actions.length === 0) return '액션을 최소 1개 이상 추가해주세요.';
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const schema = ACTION_SCHEMAS[action.type];
    if (!schema) return `등록되지 않은 액션 타입입니다: ${action.type}`;
    for (const f of schema.fields) {
      if (!f.required) continue;
      if (f.showIf && !f.showIf(action.params)) continue;
      const v = action.params[f.key];
      if (v === undefined || v === null || String(v).trim() === '') {
        return `액션 ${i + 1} (${schema.label}) — "${f.label}" 항목을 입력해주세요.`;
      }
    }
  }
  return null;
}
