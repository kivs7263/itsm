'use client';

import * as React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type { CI, CIsResponse } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// Zod 스키마
// -----------------------------------------------------------------------
const schema = z.object({
  ci_id: z.string().min(1, '연결할 CI를 선택해주세요.'),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// -----------------------------------------------------------------------
// 폼 필드 래퍼
// -----------------------------------------------------------------------
function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-error-text">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------
interface LinkCIModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  crId: string;
  /** 이미 연결된 CI id 목록 — 검색 결과에서 제외 */
  excludeCiIds?: string[];
}

// -----------------------------------------------------------------------
// LinkCIModal — 변경 요청에 영향 CI 검색·연결
// -----------------------------------------------------------------------
export function LinkCIModal({
  open,
  onClose,
  tenantSlug,
  crId,
  excludeCiIds = [],
}: LinkCIModalProps) {
  const queryClient = useQueryClient();
  const [ciSearch, setCiSearch] = useState('');
  const [selectedCI, setSelectedCI] = useState<CI | null>(null);

  const {
    handleSubmit,
    register,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ci_id: '', notes: '' },
  });

  const ciId = watch('ci_id');

  // CI 검색
  const { data: ciData, isLoading: ciLoading } = useQuery<CIsResponse>({
    queryKey: ['cmdb-cis-search', tenantSlug, ciSearch],
    queryFn: () =>
      api.get(`/${tenantSlug}/cmdb/cis`, {
        params: { search: ciSearch || undefined, page_size: 20 },
      }).then((r) => r.data),
    enabled: open && !!tenantSlug,
  });

  const ciList: CI[] = ciData?.items ?? [];

  // 이미 연결된 CI 제외
  const filteredCIs = ciList.filter((c) => !excludeCiIds.includes(c.id));

  function handleClose() {
    reset();
    setCiSearch('');
    setSelectedCI(null);
    onClose();
  }

  function handleSelectCI(ci: CI) {
    setSelectedCI(ci);
    setValue('ci_id', ci.id);
  }

  async function onSubmit(values: FormValues) {
    try {
      await api.post(`/${tenantSlug}/change-requests/${crId}/ci-links`, {
        ci_id: values.ci_id,
        notes: values.notes || null,
      });
      toast.success('CI가 연결되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['change-request', tenantSlug, crId] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>CI 연결</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-0">
          <div className="flex flex-col gap-4">
            {/* CI 검색 */}
            <FormField label="연결할 CI" required error={errors.ci_id?.message}>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
                <input
                  type="text"
                  value={ciSearch}
                  onChange={(e) => {
                    setCiSearch(e.target.value);
                    setSelectedCI(null);
                    setValue('ci_id', '');
                  }}
                  placeholder="CI 이름, 호스트명 또는 IP로 검색..."
                  className="h-9 w-full pl-8 pr-3 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>

              {/* 선택된 CI 표시 */}
              {selectedCI && (
                <div className="flex items-center justify-between rounded-md border border-brand bg-brand/5 px-3 py-2 text-sm">
                  <span className="text-text-primary font-medium">{selectedCI.name}</span>
                  <button
                    type="button"
                    onClick={() => { setSelectedCI(null); setValue('ci_id', ''); }}
                    className="text-xs text-text-secondary hover:text-text-primary"
                  >
                    변경
                  </button>
                </div>
              )}

              {/* CI 목록 드롭다운 */}
              {!selectedCI && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border-default bg-surface shadow-sm">
                  {ciLoading ? (
                    <div className="px-3 py-2 text-xs text-text-disabled">검색 중...</div>
                  ) : filteredCIs.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-disabled">결과 없음</div>
                  ) : (
                    filteredCIs.map((ci) => (
                      <button
                        key={ci.id}
                        type="button"
                        onClick={() => handleSelectCI(ci)}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-sm',
                          'hover:bg-surface-hover transition-colors',
                          ciId === ci.id && 'bg-surface-hover',
                        )}
                      >
                        <span className="text-text-primary font-medium">{ci.name}</span>
                        <span className="text-xs text-text-disabled ml-2">
                          {typeof ci.ip_address === 'string' && ci.ip_address ? ci.ip_address : ci.ci_type}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </FormField>

            {/* 비고 */}
            <FormField label="비고" error={errors.notes?.message}>
              <textarea
                {...register('notes')}
                rows={2}
                placeholder="연결 사유 등 (선택)"
                className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit(onSubmit)} isLoading={isSubmitting} disabled={!ciId}>
            연결
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
