/**
 * chart-colors.ts — ITSM 전용 색상 상수 (KPI 카드 아이콘·진행바 그라디언트 등)
 *
 * recharts/인라인 style hex는 CSS 변수(var())를 직접 참조할 수 없음 → hex 상수로 별도 관리.
 * globals.css :root 시맨틱 값(--color-success/warning/error/info) 수정 시 반드시 이 파일도 동기화.
 *
 * RA-V2: reports/page.tsx에 흩어져 있던 팔레트밖 임의 hex 16건(7종)을 이 파일로 이관.
 * - 상태 의미가 있는 KPI(성공률·준수율·에스컬레이션 등) → 시맨틱 토큰(success/warning/danger/info)
 * - 상태 의미 없는 순수 시각 구분용 KPI 아이콘 색 → CATEGORY_COLORS (임의 치환 금지, 그대로 보존·중앙화만)
 */

// === 시맨틱 — CLAUDE.md 브랜드 시스템 정본 (globals.css :root와 동일 값) ===
export const CHART_COLORS_LIGHT = {
  brand:   '#129B8E', // ITSM 제품 accent (globals.css --color-brand)
  success: '#1F8A5B',
  warning: '#B8801F',
  danger:  '#D2553F',
  info:    '#3B7DD8',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS_LIGHT;

// 카드 아이콘 배경(12% 알파) — reports 페이지 KPI 카드 관례값
export const CHART_BG_LIGHT = {
  brand:   'rgba(18, 155, 142, 0.12)',
  success: 'rgba(31, 138, 91, 0.12)',
  warning: 'rgba(184, 128, 31, 0.12)',
  danger:  'rgba(210, 85, 63, 0.12)',
  info:    'rgba(59, 125, 216, 0.12)',
} as const;

// === 카테고리 팔레트 — 상태 의미 없는 KPI 아이콘 시각 구분용 (semantic 아님, hex 보존·중앙화만) ===
export const CATEGORY_COLORS = {
  orange: '#f97316', // MTTA (평균 응답 시간)
  violet: '#8b5cf6', // 반복 장애율
  purple: '#a855f7', // 이번 달 해결
  slate:  '#64748b', // 총 공수
} as const;

export const CATEGORY_BG_LIGHT = {
  orange: 'rgba(249, 115, 22, 0.12)',
  violet: 'rgba(139, 92, 246, 0.12)',
  purple: 'rgba(168, 85, 247, 0.12)',
  slate:  'rgba(100, 116, 139, 0.12)',
} as const;

// Alveo 플랫폼 정본 amber (packages/tokens — 로고·스위처 공통) — 진행바 그라디언트 종료색으로 사용
export const ALVEO_AMBER = '#E3A53C';

// 진행바(MonthlyBar/ScoreBar/CSAT trend) 공통 그라디언트 — ITSM brand → Alveo amber
export const BRAND_PROGRESS_GRADIENT = `linear-gradient(90deg, ${CHART_COLORS_LIGHT.brand}, ${ALVEO_AMBER})`;
