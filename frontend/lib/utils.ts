import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn — Tailwind 클래스 병합 유틸리티
 * clsx로 조건부 클래스 처리 + tailwind-merge로 충돌 제거
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * formatRelativeTime — 상대 시간 포맷
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const target = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - target.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) {
    const h = target.getHours().toString().padStart(2, '0');
    const m = target.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
  if (diffDay === 1) return '어제';
  const y = target.getFullYear();
  const mo = (target.getMonth() + 1).toString().padStart(2, '0');
  const d = target.getDate().toString().padStart(2, '0');
  return `${y}.${mo}.${d}`;
}

/**
 * getInitials — 이름에서 이니셜 추출
 * 한글: 첫 글자, 영문: 앞 2글자
 */
export function getInitials(name: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  const isKorean = /[가-힣]/.test(trimmed);
  if (isKorean) return trimmed[0];
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * formatBadgeCount — 뱃지 숫자 포맷 (99+ 처리)
 */
export function formatBadgeCount(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}

/**
 * formatWorkHours — 공수 시간 표시
 * 1분 미만 → "N초", 1시간 미만 → "N분", 이상 → "1.5h"
 */
export function formatWorkHours(hours: number): string {
  const totalSecs = Math.round(hours * 3600);
  if (totalSecs < 60) return `${totalSecs}초`;
  const totalMins = Math.round(hours * 60);
  if (totalMins < 60) return `${totalMins}분`;
  const h = Math.round(hours * 100) / 100;
  return `${h}h`;
}
