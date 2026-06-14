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
  asset_tag: string | null;
  model: string | null;
  asset_type: string | null;
  customer_id: string | null;
  customer_name?: string;
  installed_at: string | null;
  warranty_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetsResponse {
  items: Asset[];
  total: number;
}

// -----------------------------------------------------------------------
// 계약 타입
// -----------------------------------------------------------------------
export interface Contract {
  id: string;
  tenant_id: string;
  name: string;
  customer_id: string | null;
  customer_name?: string;
  contract_type: string | null;
  sla_tier: ContractTier | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractsResponse {
  items: Contract[];
  total: number;
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
