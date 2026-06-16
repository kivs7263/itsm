'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { SupportTeam, EscalationReason } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// -----------------------------------------------------------------------
// 사유 레이블
// -----------------------------------------------------------------------
const REASON_OPTIONS: { value: EscalationReason; label: string }[] = [
  { value: 'technical_complexity', label: '기술적 복잡도' },
  { value: 'permission_lack',      label: '권한 부족' },
  { value: 'sla_breach',           label: 'SLA 위반' },
  { value: 'sla_warning',          label: 'SLA 경고' },
  { value: 'customer_request',     label: '고객 요청' },
  { value: 'manual',               label: '직접 지정' },
  { value: 'other',                label: '기타' },
];

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------
interface EscalationModalProps {
  open: boolean;
  onClose: () => void;
  ticketId: string;
  tenantSlug: string;
  onSuccess?: () => void;
}

// -----------------------------------------------------------------------
// EscalationModal
// -----------------------------------------------------------------------
export function EscalationModal({
  open,
  onClose,
  ticketId,
  tenantSlug,
  onSuccess,
}: EscalationModalProps) {
  const queryClient = useQueryClient();

  const [toTeamId, setToTeamId] = React.useState('');
  const [reason, setReason] = React.useState<EscalationReason>('technical_complexity');
  const [handoverMemo, setHandoverMemo] = React.useState('');
  const [customerSummary, setCustomerSummary] = React.useState('');
  const [notifyEmail, setNotifyEmail] = React.useState(true);

  // 폼 초기화 (모달 열릴 때)
  React.useEffect(() => {
    if (open) {
      setToTeamId('');
      setReason('technical_complexity');
      setHandoverMemo('');
      setCustomerSummary('');
      setNotifyEmail(true);
    }
  }, [open]);

  // 지원 팀 목록 조회
  const { data: teams = [], isLoading: teamsLoading } = useQuery<SupportTeam[]>({
    queryKey: ['support-teams', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/support-teams`).then((r) => {
        const d = r.data;
        if (Array.isArray(d)) return d;
        if (Array.isArray(d?.items)) return d.items;
        return [];
      }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const activeTeams = teams.filter((t) => t.is_active);

  // validation
  const memoTooShort = handoverMemo.trim().length > 0 && handoverMemo.trim().length < 10;
  const isValid =
    toTeamId !== '' &&
    handoverMemo.trim().length >= 10;

  // 에스컬레이션 mutation
  const escalateMutation = useMutation({
    mutationFn: () =>
      api.post(`/${tenantSlug}/tickets/${ticketId}/escalations`, {
        to_team_id: toTeamId,
        reason,
        handover_memo: handoverMemo.trim(),
        customer_summary: customerSummary.trim() || null,
        notify_channels: notifyEmail ? ['email'] : [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', tenantSlug, ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['escalations', tenantSlug, ticketId] });
      toast.success('이관이 완료되었습니다.');
      onSuccess?.();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>2차 이관</DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-2 flex flex-col gap-5">
          {/* 이관 대상 팀 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">
              이관 대상 팀 <span className="text-red-500">*</span>
            </label>
            {teamsLoading ? (
              <div className="h-9 rounded-md border border-border-default bg-surface-elevated animate-pulse" />
            ) : (
              <select
                value={toTeamId}
                onChange={(e) => setToTeamId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong disabled:opacity-50"
              >
                <option value="">팀을 선택하세요</option>
                {activeTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} (Lv.{team.level}
                    {team.member_count > 0 ? ` · ${team.member_count}명` : ''})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 사유 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-text-primary">
              이관 사유 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {REASON_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <input
                    type="radio"
                    name="escalation-reason"
                    value={opt.value}
                    checked={reason === opt.value}
                    onChange={() => setReason(opt.value)}
                    className="h-3.5 w-3.5 accent-brand"
                  />
                  <span className="text-sm text-text-primary">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 인수인계 내용 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">
              인수인계 내용 <span className="text-red-500">*</span>
              <span className="ml-1 text-xs font-normal text-text-secondary">(최소 10자)</span>
            </label>
            <textarea
              value={handoverMemo}
              onChange={(e) => setHandoverMemo(e.target.value)}
              placeholder="2차 팀이 즉시 파악할 수 있도록 현재 상황을 작성해 주세요"
              rows={4}
              className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
            {memoTooShort && (
              <p className="text-xs text-red-500">10자 이상 입력해주세요. ({handoverMemo.trim().length}/10)</p>
            )}
            {handoverMemo.trim().length >= 10 && (
              <p className="text-xs text-text-secondary text-right">{handoverMemo.trim().length}자</p>
            )}
          </div>

          {/* 고객 공유 요약 (optional) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">
              고객 공유 요약
              <span className="ml-1 text-xs font-normal text-text-secondary">(선택 · 최대 300자)</span>
            </label>
            <textarea
              value={customerSummary}
              onChange={(e) => {
                if (e.target.value.length <= 300) setCustomerSummary(e.target.value);
              }}
              placeholder="고객에게 전달할 한 줄 요약 (선택)"
              rows={2}
              className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
            />
            {customerSummary.length > 0 && (
              <p className="text-xs text-text-secondary text-right">{customerSummary.length}/300</p>
            )}
          </div>

          {/* 알림 채널 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text-primary">알림 채널</span>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand"
              />
              <span className="text-sm text-text-primary">이메일</span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={escalateMutation.isPending}
          >
            취소
          </Button>
          <Button
            onClick={() => escalateMutation.mutate()}
            isLoading={escalateMutation.isPending}
            disabled={!isValid || escalateMutation.isPending}
            className="bg-orange-500 hover:bg-orange-600 text-white border-0"
          >
            이관 확정
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
