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
  contract_tier: ContractTier | null;
  created_at: string;
  updated_at: string;
}

export interface CustomersResponse {
  items: Customer[];
  total: number;
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
// 리포트 타입
// -----------------------------------------------------------------------
export interface ReportSummary {
  monthly_tickets: { month: string; count: number }[];
  by_status: { status: TicketStatus; count: number }[];
  sla_compliance_rate: number;
}
