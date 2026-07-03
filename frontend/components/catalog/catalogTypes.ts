/**
 * components/catalog/catalogTypes.ts — 서비스 카탈로그 관리자 UI 공용 타입
 *
 * 백엔드 계약 근거: backend/app/routers/service_catalog.py
 *   CategoryOut  : L68-79   / OfferingOut : L114-133
 * approval_policy 구조 근거: backend/app/services/catalog_approval.py L1-44
 * form_schema 구조 근거   : backend/app/services/catalog_form.py L1-27
 *
 * FormField 등 form_schema 필드 타입은 components/catalog/DynamicForm.tsx 재사용
 * (신청 폼 렌더러와 관리자 편집기가 동일 구조를 공유해야 하므로 타입 중복 정의 금지).
 */

import type { FormField } from '@/components/catalog/DynamicForm';

// -----------------------------------------------------------------------
// 카테고리 — service_catalog.py CategoryOut(L68-79)
// -----------------------------------------------------------------------
export interface ServiceCategory {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  parent_id: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryCreatePayload {
  name: string;
  slug: string;
  icon?: string | null;
  parent_id?: string | null;
  display_order?: number;
}

export interface CategoryUpdatePayload {
  name?: string;
  icon?: string | null;
  parent_id?: string | null;
  display_order?: number;
  is_active?: boolean;
}

// -----------------------------------------------------------------------
// approval_policy — catalog_approval.py L1-44 (v1/v2 하위호환)
// -----------------------------------------------------------------------
export type ApprovalOp = '>=' | '>' | '<=' | '<' | '==' | '!=';
export type ApprovalLineType = 'approver' | 'agreement' | 'reference';

export interface ApprovalCondition {
  field: string;
  op: ApprovalOp;
  value: string | number;
}

export interface ApprovalStep {
  order: number;
  approvers: string[];
  line_type: ApprovalLineType;
  /** 없으면 항상 포함 (조건부 아님) */
  condition?: ApprovalCondition | null;
}

export interface ApprovalPolicy {
  /** false면 결재 없이 draft (v1 하위호환). true + steps 없음 = 단일 승인만 필요 */
  required: boolean;
  steps?: ApprovalStep[];
}

export const APPROVAL_OPS: { value: ApprovalOp; label: string }[] = [
  { value: '>=', label: '이상 (>=)' },
  { value: '>', label: '초과 (>)' },
  { value: '<=', label: '이하 (<=)' },
  { value: '<', label: '미만 (<)' },
  { value: '==', label: '같음 (==)' },
  { value: '!=', label: '다름 (!=)' },
];

export const APPROVAL_LINE_TYPES: { value: ApprovalLineType; label: string }[] = [
  { value: 'approver', label: '결재자' },
  { value: 'agreement', label: '합의자' },
  { value: 'reference', label: '참조자' },
];

// -----------------------------------------------------------------------
// form_schema — catalog_form.py L1-27
// -----------------------------------------------------------------------
export interface ServiceFormSchema {
  version?: string | number;
  fields: FormField[];
}

// -----------------------------------------------------------------------
// 오퍼링 — service_catalog.py OfferingOut(L114-133)
// -----------------------------------------------------------------------
export type OfferingPriority = 'low' | 'medium' | 'high' | 'critical';
export type OfferingSlaGrade = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface ServiceOffering {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  request_type: string;
  default_priority: OfferingPriority;
  default_sla_grade: OfferingSlaGrade | null;
  form_schema: ServiceFormSchema;
  approval_policy: ApprovalPolicy;
  is_active: boolean;
  is_system: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface OfferingCreatePayload {
  code: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  category_id?: string | null;
  request_type: string;
  default_priority: OfferingPriority;
  default_sla_grade?: OfferingSlaGrade | null;
  form_schema: ServiceFormSchema;
  approval_policy: ApprovalPolicy;
  display_order?: number;
}

/** PATCH — is_system=True면 백엔드가 name/description/icon/category_id/
 *  request_type/default_priority/default_sla_grade/display_order 를 403 차단
 *  (service_catalog.py L454-480). form_schema/approval_policy만 허용. */
export type OfferingUpdatePayload = Partial<OfferingCreatePayload>;

// -----------------------------------------------------------------------
// request_type 옵션 — models/ticket.py L84 주석 값 재사용 (별도 enum 없음, free string)
// -----------------------------------------------------------------------
export const REQUEST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'incident', label: '장애 (incident)' },
  { value: 'service_request', label: '서비스 요청 (service_request)' },
  { value: 'installation', label: '설치 (installation)' },
  { value: 'upgrade', label: '업그레이드 (upgrade)' },
  { value: 'technical_inquiry', label: '기술 문의 (technical_inquiry)' },
  { value: 'maintenance', label: '유지보수 (maintenance)' },
];

export const PRIORITY_OPTIONS: { value: OfferingPriority; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음' },
  { value: 'critical', label: '긴급' },
];

export const SLA_GRADE_OPTIONS: { value: OfferingSlaGrade; label: string }[] = [
  { value: 'bronze', label: 'Bronze' },
  { value: 'silver', label: 'Silver' },
  { value: 'gold', label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

export const FIELD_TYPE_OPTIONS: { value: FormField['type']; label: string }[] = [
  { value: 'string', label: '텍스트' },
  { value: 'textarea', label: '긴 텍스트' },
  { value: 'number', label: '숫자' },
  { value: 'select', label: '단일 선택' },
  { value: 'multiselect', label: '다중 선택' },
  { value: 'date', label: '날짜' },
  { value: 'boolean', label: '체크박스' },
];
