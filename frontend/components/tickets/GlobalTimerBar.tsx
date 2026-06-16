'use client';

import * as React from 'react';
import { Square, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { WorkLogStopModal } from './WorkLogStopModal';

interface TimerActive {
  active: boolean;
  ticket_id: string | null;
  started_at: string | null;
  elapsed_seconds: number | null;
}

function useElapsed(startedAt: string | null, active: boolean): string {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!active || !startedAt) { setElapsed(0); return; }
    const base = Date.now() - new Date(startedAt).getTime();
    setElapsed(Math.floor(base / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface GlobalTimerBarProps {
  tenantSlug: string;
}

export function GlobalTimerBar({ tenantSlug }: GlobalTimerBarProps) {
  const [showStopModal, setShowStopModal] = React.useState(false);

  const { data: timer } = useQuery<TimerActive>({
    queryKey: ['work-timer', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/work-logs/timer/active`).then((r) => r.data),
    refetchInterval: 10000,
  });

  const elapsed = useElapsed(timer?.started_at ?? null, timer?.active ?? false);

  if (!timer?.active) return null;

  return (
    <>
      <div className="flex items-center gap-3 rounded-md bg-amber-500 text-[#1A1A1A] px-3 py-1.5">
        <Clock size={13} className="shrink-0 animate-pulse" />
        <span className="text-xs font-medium whitespace-nowrap">타이머 실행 중</span>
        <span className="font-mono text-sm font-semibold tabular-nums">{elapsed}</span>
        <button
          onClick={() => setShowStopModal(true)}
          className="flex items-center gap-1 rounded bg-[#1A1A1A]/20 hover:bg-[#1A1A1A]/30 px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap"
        >
          <Square size={10} />
          중지
        </button>
      </div>

      <WorkLogStopModal
        open={showStopModal}
        onClose={() => setShowStopModal(false)}
        tenantSlug={tenantSlug}
        elapsed={elapsed}
      />
    </>
  );
}
