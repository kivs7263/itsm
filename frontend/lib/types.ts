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

export interface CIRelationship {
  id: string;
  from_ci_id: string;
  to_ci_id: string;
  rel_type: RelType;
  from_ci?: CI;
  to_ci?: CI;
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

export interface CIDetail extends CI {
  relationships_from: CIRelationship[];
  relationships_to: CIRelationship[];
  history: CIHistory[];
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
  linked_business_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaBusiness {
  id: string;
  name: string;
  status?: string;
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
  tier: ContractTier;
  response_hours: number;
  resolution_hours: number;
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
  is_published: boolean;
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

export interface ExtNotifLog {
  id: string;
  ticket_id: string | null;
  escalation_id: string | null;
  channel: string;
  event_type: string;
  recipient: string;
  status: string;
  error_msg: string | null;
  retry_count: number;
  next_retry_at: string | null;
  sent_at: string | null;
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
