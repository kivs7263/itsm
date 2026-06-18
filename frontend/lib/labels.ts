import type { TicketStatus, TicketPriority } from './types';
import type { Locale } from './locale';

const STATUS: Record<Locale, Record<TicketStatus, string>> = {
  ko: { open: '열림', in_progress: '진행 중', pending: '대기', resolved: '해결됨', closed: '닫힘' },
  en: { open: 'Open', in_progress: 'In Progress', pending: 'Pending', resolved: 'Resolved', closed: 'Closed' },
};

const PRIORITY: Record<Locale, Record<TicketPriority, string>> = {
  ko: { low: '낮음', medium: '보통', high: '높음', critical: '긴급' },
  en: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
};

export function getStatusLabels(locale: Locale = 'ko'): Record<TicketStatus, string> {
  return STATUS[locale];
}

export function getPriorityLabels(locale: Locale = 'ko'): Record<TicketPriority, string> {
  return PRIORITY[locale];
}

export const STATUS_LABELS_KO = STATUS.ko;
export const PRIORITY_LABELS_KO = PRIORITY.ko;
