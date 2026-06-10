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
