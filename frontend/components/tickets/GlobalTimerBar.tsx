'use client';

import * as React from 'react';
import { Square, Clock, ExternalLink } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { WorkLogStopModal } from './WorkLogStopModal';

interface TimerActiveItem {
  ticket_id: string;
  ticket_number: string | null;
  ticket_title: string | null;
  started_at: string;
  elapsed_seconds: number;
}

function useElapsed(startedAt: string): string {
  const [elapsed, setElapsed] = React.useState(() =>
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
  );
  React.useEffect(() => {
    setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function TimerPill({
  item,
  tenantSlug,
  onStop,
}: {
  item: TimerActiveItem;
  tenantSlug: string;
  onStop: (item: TimerActiveItem) => void;
}) {
  const router = useRouter();
  const elapsed = useElapsed(item.started_at);

  return (
    <div className="flex items-center gap-1.5 rounded-md pl-2.5 pr-1 py-1 text-[#1A1A1A]" style={{ background: 'var(--color-warning)' }}>
      <Clock size={11} className="shrink-0 animate-pulse" />
      <span className="font-mono text-xs font-semibold tabular-nums">{elapsed}</span>

      <button
        onClick={() => router.push(`/${tenantSlug}/tickets?focus=${item.ticket_id}`)}
        className="flex items-center gap-1 max-w-[140px] hover:underline"
        title={item.ticket_title ?? undefined}
      >
        {item.ticket_number && (
          <span className="text-[11px] font-medium opacity-70 shrink-0">{item.ticket_number}</span>
        )}
        {item.ticket_title && (
          <span className="text-[11px] truncate">{item.ticket_title}</span>
        )}
        <ExternalLink size={9} className="shrink-0 opacity-50" />
      </button>

      <button
        onClick={() => onStop(item)}
        className="flex items-center rounded p-0.5 transition-colors ml-0.5 bg-black/20 hover:bg-black/35"
        aria-label="중지"
      >
        <Square size={11} />
      </button>
    </div>
  );
}

interface GlobalTimerBarProps {
  tenantSlug: string;
}

export function GlobalTimerBar({ tenantSlug }: GlobalTimerBarProps) {
  const queryClient = useQueryClient();
  const [stoppingItem, setStoppingItem] = React.useState<TimerActiveItem | null>(null);

  const { data: timers = [] } = useQuery<TimerActiveItem[]>({
    queryKey: ['work-timer', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/work-logs/timer/active`).then((r) => r.data),
    refetchInterval: 10000,
  });

  if (timers.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {timers.map((item) => (
          <TimerPill
            key={item.ticket_id}
            item={item}
            tenantSlug={tenantSlug}
            onStop={setStoppingItem}
          />
        ))}
        {timers.length > 1 && (
          <span className="text-xs text-text-secondary tabular-nums">
            {timers.length}개 실행 중
          </span>
        )}
      </div>

      {stoppingItem && (
        <WorkLogStopModal
          open={true}
          onClose={() => setStoppingItem(null)}
          tenantSlug={tenantSlug}
          ticketId={stoppingItem.ticket_id}
          elapsed={(() => {
            const s = Math.floor((Date.now() - new Date(stoppingItem.started_at).getTime()) / 1000);
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
          })()}
          title={stoppingItem.ticket_title
            ? `${stoppingItem.ticket_number ?? ''} ${stoppingItem.ticket_title}`.trim()
            : undefined}
          onStopped={() => {
            queryClient.invalidateQueries({ queryKey: ['work-timer', tenantSlug] });
            setStoppingItem(null);
          }}
        />
      )}
    </>
  );
}
