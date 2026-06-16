'use client';

import * as React from 'react';
import { Square, Clock, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { WorkLogStopModal } from './WorkLogStopModal';

interface TimerActive {
  active: boolean;
  ticket_id: string | null;
  ticket_number: string | null;
  ticket_title: string | null;
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
  const router = useRouter();
  const [showStopModal, setShowStopModal] = React.useState(false);

  const { data: timer } = useQuery<TimerActive>({
    queryKey: ['work-timer', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/work-logs/timer/active`).then((r) => r.data),
    refetchInterval: 10000,
  });

  const elapsed = useElapsed(timer?.started_at ?? null, timer?.active ?? false);

  if (!timer?.active) return null;

  const ticketLabel = timer.ticket_number
    ? `${timer.ticket_number}`
    : timer.ticket_id?.slice(0, 6) ?? '';

  function goToTicket() {
    if (!timer?.ticket_id) return;
    router.push(`/${tenantSlug}/tickets?focus=${timer.ticket_id}`);
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-md bg-amber-500 text-[#1A1A1A] pl-2.5 pr-1.5 py-1">
        <Clock size={12} className="shrink-0 animate-pulse" />
        <span className="font-mono text-sm font-semibold tabular-nums">{elapsed}</span>

        {/* 티켓 정보 — 클릭 시 해당 티켓으로 이동 */}
        <button
          onClick={goToTicket}
          className="flex items-center gap-1 max-w-[180px] hover:underline"
          title={timer.ticket_title ?? undefined}
        >
          {ticketLabel && (
            <span className="text-xs font-medium opacity-70 shrink-0">{ticketLabel}</span>
          )}
          {timer.ticket_title && (
            <span className="text-xs truncate">{timer.ticket_title}</span>
          )}
          <ExternalLink size={10} className="shrink-0 opacity-60" />
        </button>

        <div className="w-px h-4 bg-[#1A1A1A]/20 mx-0.5" />

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
