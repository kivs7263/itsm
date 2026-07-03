/**
 * lib/types.ts — ITSM 공통 타입 정의
 */

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed';
export type TicketChannel = 'email' | 'phone' | 'portal' | 'internal';

export interface Ticket {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  contract_id: string | null;
  assigned_to: string | null;
  title: string;
  description: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  channel: TicketChannel;
  source: string | null;
  request_type: string | null;
  parent_ticket_id: string | null;
  ticket_number: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  // 조인 필드 (API가 채워줌)
  customer_name?: string;
  assignee_name?: string;
  sla_response_deadline?: string | null;   // ISO datetime
  sla_resolution_deadline?: string | null; // ISO datetime
  // P5-3 반복 장애
  is_recurring_flag?: boolean;
  // ESC-5 에스컬레이션
  escalation_level?: number;
  escalation_count?: number;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface TicketsResponse {
  items: Ticket[];
  total: number;
}

// -----------------------------------------------------------------------
// CMDB 타입
// -----------------------------------------------------------------------
export type CIType =
  | 'server'
  | 'workstation'
  | 'network_device'
  | 'application'
  | 'service'
  | 'database'
  | 'virtual_machine'
  | 'cloud_resource'
  | 'storage'
  | 'firewall'
  | 'router_switch'
  | 'printer';

export type CIStatus = 'active' | 'inactive' | 'maintenance' | 'decommissioned';
export type CIEnvironment = 'production' | 'staging' | 'development' | 'testing' | 'dr';
export type CICriticality = 'critical' | 'high' | 'medium' | 'low';

export type RelType =
  | 'depends_on'
  | 'hosted_on'
  | 'runs_on'
  | 'connects_to'
  | 'part_of'
  | 'manages'
  | 'backed_up_to';

export interface CI {
  id: string;
  tenant_id: string;
  name: string;
  ci_type: CIType;
  environment: CIEnvironment;
  status: CIStatus;
  criticality: CICriticality;
  customer_id: string | null;
  customer_name?: string;
  hostname: string | null;
  ip_address: string | null;
  os_type: string | null;
  os_version: string | null;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CIsResponse {
  items: CI[];
  total: number;
}

/** 백엔드 GET /{tenant}/cmdb/cis/{id} 응답의 relationships 배열 항목 */
export interface CIRelationship {
  id: string;
  rel_type: RelType;
  /** "out" = 현재 CI → 대상 / "in" = 대상 → 현재 CI */
  direction: 'out' | 'in';
  related_ci: {
    id: string;
    name: string;
    ci_type: string;
    status: string;
  } | null;
}

export interface CIHistory {
  id: string;
  ci_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  change_reason: string | null;
  changed_by: string | null;
  created_at: string;
}

/** 백엔드 GET /{tenant}/cmdb/cis/{id} 응답 구조 */
export interface CIDetailResponse {
  ci: CI;
  relationships: CIRelationship[];
}

/** @deprecated 사용하지 말 것 — CIDetailResponse 사용 */
export interface CIDetail extends CI {
  relationships_from: never[];
  relationships_to: never[];
  history: CIHistory[];
}

// -----------------------------------------------------------------------
// CMDB SNMP Discovery 타입 (RX-3c)
// 백엔드: app/routers/cmdb.py DiscoveryStartRequest / DiscoveryRunOut
// -----------------------------------------------------------------------
export type DiscoveryRunStatus = 'pending' | 'running' | 'completed' | 'failed';

/** POST /{tenant}/cmdb/discovery 요청 바디 (cmdb.py:868 DiscoveryStartRequest) */
export interface DiscoveryStartRequest {
  target: string;
  community?: string;
  port?: number;
  timeout?: number;
  customer_id?: string | null;
}

/** cmdb.py:883 DiscoveryRunOut */
export interface DiscoveryRun {
  id: string;
  tenant_id: string;
  target: string;
  status: DiscoveryRunStatus;
  started_at: string | null;
  finished_at: string | null;
  discovered_count: number;
  error_count: number;
  errors: Array<{ host?: string; message?: string; [key: string]: unknown }>;
  created_by: string | null;
  created_at: string;
}

/** GET /{tenant}/cmdb/discovery/runs 응답 (cmdb.py:1101) */
export interface DiscoveryRunsResponse {
  items: DiscoveryRun[];
  total: number;
  page: number;
  page_size: number;
}

// -----------------------------------------------------------------------
// 고객 타입
// -----------------------------------------------------------------------
export type ContractTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  contract_grade: string | null;
  contract_tier: ContractTier | null;
  parent_id: string | null;
  kind: 'account' | 'division';
  created_at: string;
  updated_at: string;
}

export interface CustomersResponse {
  items: Customer[];
  total: number;
  page: number;
  page_size: number;
}

export interface CustomerTreeNode {
  id: string;
  name: string;
  kind: 'account' | 'division';
  children: CustomerTreeNode[];
}

export interface CustomerRollup {
  customer_id: string;
  name: string;
  open_tickets: number;
  total_hours_this_month: number;
  active_assets: number;
  active_contracts: number;
}

export interface CustomerNote {
  id: string;
  customer_id: string;
  title: string | null;
  content: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------
// 자산 타입
// -----------------------------------------------------------------------
export interface Asset {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name?: string;
  asset_tag: string;
  model: string;
  serial: string | null;
  asset_type: string;
  status: string; // active | retired | disposed (RX-0a)
  location: Record<string, unknown> | null;
  installed_at: string | null;
  warranty_end: string | null;
  license_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetsResponse {
  items: Asset[];
  total: number;
  page: number;
  page_size: number;
}

// -----------------------------------------------------------------------
// 계약 타입
// -----------------------------------------------------------------------
export interface Contract {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name?: string;
  name: string;
  type: string;
  sla_grade: string;
  start_date: string;
  end_date: string;
  amount: string | null;
  support_hours: string | null;
  memo: string | null;
  linked_business_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractsResponse {
  items: Contract[];
  total: number;
  page: number;
  page_size: number;
}

// -----------------------------------------------------------------------
// SLA 타입
// -----------------------------------------------------------------------
export interface SlaPolicy {
  id: string;
  tenant_id: string;
  /** 백엔드 SLAPolicyOut 필드명: grade (bronze|silver|gold|platinum) */
  grade: ContractTier;
  /** 백엔드 SLAPolicyOut 필드명: response_minutes */
  response_minutes: number;
  /** 백엔드 SLAPolicyOut 필드명: resolution_minutes */
  resolution_minutes: number;
  created_at: string;
}

export interface SlaDashboard {
  active_tickets: number;
  sla_violations: number;
  sla_warnings: number;
  compliance_rate: number;
}

// -----------------------------------------------------------------------
// Change Management 타입
// -----------------------------------------------------------------------
export type CRChangeType = 'normal' | 'emergency' | 'standard';
export type CRStatus =
  | 'draft'
  | 'pending_review'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled';
export type CRRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type CRPriority = 'low' | 'medium' | 'high' | 'critical';

export interface CRLinkedCI {
  ci_id: string;
  ci_name: string;
  notes: string | null;
}

export interface ChangeRequest {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  change_type: CRChangeType;
  status: CRStatus;
  risk_level: CRRiskLevel;
  priority: CRPriority;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  rollback_plan: string | null;
  implementation_plan: string | null;
  test_plan: string | null;
  requestor_id: string | null;
  implementor_id: string | null;
  reviewer_id: string | null;
  requestor_name: string | null;
  implementor_name: string | null;
  reviewer_name: string | null;
  gw_approval_doc_id: string | null;
  gw_approval_status: string;
  linked_cis: CRLinkedCI[];
  created_at: string;
  updated_at: string;
}

export interface ChangeRequestsResponse {
  items: ChangeRequest[];
  total: number;
}

// -----------------------------------------------------------------------
// 리포트 타입
// -----------------------------------------------------------------------
export interface ReportSummary {
  monthly_tickets: { month: string; count: number }[];
  by_status: { status: TicketStatus; count: number }[];
  sla_compliance_rate: number;
  sla_breach_count?: number;
  monthly_resolved?: number;
  csat_summary?: CSATSummary;
  mttr_minutes?: number | null;
  mtta_minutes?: number | null;
  fcr_rate?: number | null;
  by_priority?: { priority: TicketPriority; count: number }[];
  kb_total_views?: number;
  kb_article_count?: number;
  kb_top_articles?: { id: string; title: string; view_count: number }[];
  total_hours?: number;
  billable_hours?: number;
  // KPI-4 신규
  age_buckets?: { '0-7d': number; '7-30d': number; '30d+': number };
  channel_breakdown?: { channel: string; count: number }[];
  escalation_rate?: number;
  recurring_rate?: number;
  // RX-0e 신규 — Reopen Rate (재오픈)
  reopen_ticket_count?: number;
  reopen_rate?: number;
  avg_reopen_count?: number;
}

// -----------------------------------------------------------------------
// CSAT
// -----------------------------------------------------------------------
export interface CSATSummary {
  total: number;
  submitted: number;
  pending: number;
  expired: number;
  avg_score: number | null;
  response_rate: number;
  score_distribution: Record<string, number>; // "1" ~ "5" 키
  monthly_trend?: { month: string; avg_score: number; count: number }[];
}

// -----------------------------------------------------------------------
// -----------------------------------------------------------------------
// 통합 인박스 (notification-service proxy) 타입
// -----------------------------------------------------------------------

/**
 * GET /api/notifications 응답 항목 — notification-service NotificationOut 스키마
 * 필드: id, event_namespace, category, title, body, action_url, is_read, created_at
 */
export interface InboxNotification {
  id: string;
  event_namespace: string;
  category: string;
  title: string;
  body: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
}

export interface InboxUnreadCountResponse {
  count: number;
}

// -----------------------------------------------------------------------
// 알림 로그 타입
// -----------------------------------------------------------------------
export type NotifChannel = 'kakao' | 'sms' | 'slack' | 'teams';
export type NotifStatus = 'sent' | 'failed' | 'skipped';

export interface NotifLog {
  id: string;
  channel: NotifChannel;
  event_type: string;
  recipient: string;
  status: NotifStatus;
  message_summary: string | null;
  error_msg: string | null;
  ticket_id: string | null;
  created_at: string;
}

export interface NotifLogsResponse {
  items: NotifLog[];
  total: number;
}

export interface ChannelStatus {
  kakao: { configured: boolean };
  sms: { configured: boolean };
  slack: { configured: boolean };
  teams: { configured: boolean };
}

// -----------------------------------------------------------------------
// 답변 템플릿 타입
// -----------------------------------------------------------------------
export interface ReplyTemplate {
  id: string;
  name: string;
  body: string;
  category: string | null;
  is_shared: boolean;
  use_count: number;
  created_at: string;
}

export interface ReplyTemplatesResponse {
  items: ReplyTemplate[];
  total: number;
}

// -----------------------------------------------------------------------
// AI 답변 초안 타입
// -----------------------------------------------------------------------
export interface AiSuggestKbSource {
  id: string;
  title: string;
}

export interface AiSuggestReplyResponse {
  draft: string | null;
  kb_sources: AiSuggestKbSource[];
  reason?: 'ai_disabled' | 'ai_error';
}

// -----------------------------------------------------------------------
// P5-3 반복 장애 알림 타입
// -----------------------------------------------------------------------
export interface RecurringAlert {
  id: string;
  customer_id: string | null;
  symptom_category_id: string | null;
  trigger_ticket_ids: string[];
  occurrence_count: number;
  detected_at: string;
  is_acknowledged: boolean;
}

export interface RecurringAlertsResponse {
  items: RecurringAlert[];
  total: number;
}

// -----------------------------------------------------------------------
// P5-4 알려진 이슈 타입
// -----------------------------------------------------------------------
export interface KnownIssue {
  id: string;
  title: string;
  ki_severity: string | null;
  ki_status: string | null;
  ki_symptom_category_id: string | null;
}

export interface KnownIssuesResponse {
  items: KnownIssue[];
  total: number;
}

// -----------------------------------------------------------------------
// 증상 분류 타입
// -----------------------------------------------------------------------
export interface SymptomCategory {
  id: string;
  name: string;
}

// -----------------------------------------------------------------------
// 고객 연락처 타입
// -----------------------------------------------------------------------
export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  memo: string | null;
  created_at: string;
}

export interface CustomerContactsResponse {
  items: CustomerContact[];
  total: number;
}

// -----------------------------------------------------------------------
// 보고서 승인 워크플로우 타입
// -----------------------------------------------------------------------
export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface Report {
  id: string;
  tenant_id: string;
  report_type: 'monthly' | 'weekly';
  period_start: string;  // YYYY-MM-DD
  period_end: string;    // YYYY-MM-DD
  title: string;
  summary_data: Record<string, unknown>;
  status: ReportStatus;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportsResponse {
  items: Report[];
  total: number;
}

// -----------------------------------------------------------------------
// KB 지식베이스 타입
// -----------------------------------------------------------------------
export interface KbArticle {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  tags: string[];
  linked_ticket_id: string | null;
  author_id: string;
  author_name: string | null;
  is_published: boolean;
  view_count: number;
  helpful_votes: number;
  not_helpful_votes: number;
  created_at: string;
  updated_at: string;
}

export interface KbArticlesResponse {
  items: KbArticle[];
  total: number;
  page: number;
  limit: number;
}

export interface SemanticSearchResult {
  id: string;
  title: string;
  content: string | null;
  category: string | null;
  similarity: number; // 0.0 ~ 1.0
}

// -----------------------------------------------------------------------
// Settings 타입
// -----------------------------------------------------------------------
export interface UserSetting {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface NotificationConfig {
  slack_webhook_url: string | null;
  teams_webhook_url: string | null;
  kakao_api_key: string | null;
  kakao_sender_key: string | null;
  sms_api_key: string | null;
  sms_api_secret: string | null;
  sms_from_number: string | null;
  // SMTP (고객 외부 알림 ESC-3)
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password_configured: boolean;
  smtp_use_tls: boolean;
  smtp_from_email: string | null;
  smtp_from_name: string | null;
  // 카카오 템플릿
  kakao_template_ticket_created: string | null;
  kakao_template_escalated: string | null;
  kakao_template_resolved: string | null;
}

export interface SupportTeam {
  id: string;
  name: string;
  level: number;
  description: string | null;
  is_active: boolean;
  member_count: number;
  created_at: string;
}

export interface SymptomCategoryItem {
  id: string;
  name: string;
  parent_id: string | null;
  children?: SymptomCategoryItem[];
}

// -----------------------------------------------------------------------
// 에스컬레이션 타입
// -----------------------------------------------------------------------
export type EscalationReason =
  | 'technical_complexity'
  | 'permission_lack'
  | 'sla_breach'
  | 'sla_warning'
  | 'customer_request'
  | 'manual'
  | 'other';

export interface EscalationOut {
  id: string;
  ticket_id: string;
  from_level: number;
  to_level: number;
  from_assigned: string | null;
  to_team_id: string;
  to_team_name: string | null;
  to_assigned: string | null;
  to_assigned_name: string | null;
  reason: string;
  handover_memo: string;
  customer_summary: string | null;
  triggered_by: string | null;
  triggered_by_name: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface SupportTeam {
  id: string;
  name: string;
  level: number;
  description: string | null;
  is_active: boolean;
  member_count: number;
}

export interface SubscriptionInfo {
  plan: 'free' | 'starter' | 'professional' | 'enterprise';
  seats_limit: number;
  ticket_limit_monthly: number | null;
  api_keys_allowed: boolean;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  is_active: boolean;
  seat_usage: number;
  ticket_usage_this_month: number;
}

export interface StripeInvoice {
  id: string;
  amount_paid: number;
  currency: string;
  status: string;
  period_end: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

// -----------------------------------------------------------------------
// Problem Management 타입 (CA-P2-4)
// -----------------------------------------------------------------------
export type ProblemStatus = 'new' | 'investigating' | 'known_error' | 'resolved' | 'closed';
export type ProblemPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Problem {
  id: string;
  tenant_id: string;
  problem_number: string;
  title: string;
  description: string | null;
  status: ProblemStatus;
  priority: ProblemPriority;
  is_known_error: boolean;
  root_cause: string | null;
  workaround: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProblemsResponse {
  items: Problem[];
  total: number;
}

export interface ProblemTicketLink {
  ticket_id: string;
  ticket_number: string | null;
  title: string;
  status: string;
  priority: string;
}

export interface ProblemDetail extends Problem {
  linked_tickets: ProblemTicketLink[];
}

// -----------------------------------------------------------------------
// CMDB Import 타입 (FRP-3d-A2)
// -----------------------------------------------------------------------
export interface ImportRun {
  id: string;
  tenant_id: string;
  source: string;          // 'csv' | 'json_api'
  target: string;          // 'ci' | 'asset'
  status: string;          // 'success' | 'partial' | 'failed'
  total_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  errors: Array<{ row?: number; message?: string; [key: string]: unknown }>;
  dedup_key: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ImportRunsResponse {
  items: ImportRun[];
  total: number;
  page: number;
  page_size: number;
}

// -----------------------------------------------------------------------
// SLA 이벤트 타입 (FRP-3d-A2)
// -----------------------------------------------------------------------
export type SlaEventType = 'breach_warning' | 'breached' | 'resolved';

export interface SlaEvent {
  id: string;
  tenant_id: string;
  ticket_id: string;
  event_type: SlaEventType;
  fired_at: string;
}

export interface SlaEventsResponse {
  items: SlaEvent[];
  total: number;
}

// -----------------------------------------------------------------------
// SLA 업무시간 캘린더 타입 (FRP-3d-A2)
// -----------------------------------------------------------------------
export interface BusinessCalendar {
  id: string;
  tenant_id: string;
  /** 요일별 구간 {"mon":[["09:00","18:00"]], ...} */
  business_hours_json: Record<string, string[][]>;
  timezone: string;
  holidays_json: string[];  // YYYY-MM-DD[]
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------
// 사용자(User) 요약 타입 — 배정 모달에서 사용
// -----------------------------------------------------------------------
export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
}

// -----------------------------------------------------------------------
// 자동화 룰 엔진 타입 (RX-3a) — backend/app/automation/router.py 근거
// -----------------------------------------------------------------------

/** 지원 트리거 이벤트 — router.py SUPPORTED_TRIGGERS와 동기화 */
export type AutomationTriggerEvent =
  | 'ticket.created'
  | 'ticket.status_changed'
  | 'ticket.assigned'
  | 'ticket.sla_breach_warning';

/** JSONLogic 조건 표현식 — evaluator.py ALLOWED_OPERATORS 기준 임의 중첩 가능 */
export type AutomationCondition = Record<string, unknown>;

/** 액션 항목 — engine.py가 action.get("type")/action.get("params") 형태로 소비 */
export interface AutomationAction {
  type: string;
  params: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_event: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  priority: number;
  run_limit_per_hour: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationRunActionResult {
  type: string;
  status: string;
  [key: string]: unknown;
}

export interface AutomationRun {
  id: string;
  rule_id: string;
  tenant_id: string;
  trigger_event: string;
  trigger_payload: Record<string, unknown>;
  matched: boolean;
  depth: number;
  idempotency_key: string | null;
  actions_result: AutomationRunActionResult[] | null;
  status: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

// -----------------------------------------------------------------------
// RX-2d: 지점(Site) 속성 + 티켓 요청자 연락처
// (append-only 블록 — 기존 Customer/CustomerTreeNode/Ticket 인터페이스는 편집하지 않고
//  교차 타입으로 확장. 병행 백엔드 마이그레이션(ADR-043 companies/sites/contacts)과 연동)
// -----------------------------------------------------------------------
export interface SiteAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
}

export interface SiteAttributes {
  address?: SiteAddress | null;
  phone?: string | null;
  timezone?: string | null;
  is_headquarters?: boolean;
}

// kind='division'(지점) 응답에 sites join으로 채워지는 필드 — Customer/CustomerTreeNode 교차 타입
export type CustomerWithSite = Customer & Partial<SiteAttributes>;
export type CustomerTreeNodeWithSite = CustomerTreeNode & Partial<SiteAttributes>;

export interface TicketRequesterFields {
  requester_contact_id?: string | null;
  requester_contact_name?: string | null;
}

export type TicketWithRequester = Ticket & TicketRequesterFields;
