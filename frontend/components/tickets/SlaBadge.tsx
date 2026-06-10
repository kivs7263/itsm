'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// SLA 배지 — deadline까지 남은 시간 표시
// 1분마다 setInterval로 갱신
// -----------------------------------------------------------------------

interface SlaBadgeProps {
  deadline: string | null | undefined;
  label?: string; // "응답" | "해결"
  className?: string;
}

function getRemainingMs(deadline: string): number {
  return new Date(deadline).getTime() - Date.now();
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '초과';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}일 ${rh}h` : `${d}일`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type SlaVariant = 'ok' | 'warning' | 'breach';

function getSlaVariant(ms: number): SlaVariant {
  if (ms <= 0) return 'breach';
  if (ms < 2 * 60 * 60 * 1000) return 'warning'; // 2시간 미만
  return 'ok';
}

const VARIANT_CLASSES: Record<SlaVariant, string> = {
  ok:      'bg-success-bg text-success-text border-transparent',
  warning: 'bg-warning-bg text-warning-text border-transparent',
  breach:  'bg-error-bg text-error-text border-transparent',
};

export function SlaBadge({ deadline, label = '응답', className }: SlaBadgeProps) {
  const [remainingMs, setRemainingMs] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!deadline) return;

    setRemainingMs(getRemainingMs(deadline));

    const interval = setInterval(() => {
      setRemainingMs(getRemainingMs(deadline));
    }, 60_000);

    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline || remainingMs === null) return null;

  const variant = getSlaVariant(remainingMs);
  const timeText = formatRemaining(remainingMs);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border',
        VARIANT_CLASSES[variant],
        className,
      )}
      aria-label={`SLA ${label} ${timeText}`}
    >
      {variant === 'breach' && (
        <AlertTriangle size={10} aria-hidden="true" />
      )}
      {label} {timeText}
    </span>
  );
}
