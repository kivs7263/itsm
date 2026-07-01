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
import type { CI, CIsResponse, RelType } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// 관계 유형 한글 매핑
// -----------------------------------------------------------------------
const REL_TYPE_LABELS: Record<RelType, string> = {
  depends_on:   '의존',
  hosted_on:    '호스팅됨',
  runs_on:      '실행됨',
  connects_to:  '연결됨',
  part_of:      '구성요소',
  manages:      '관리',
  backed_up_to: '백업됨',
};

// -----------------------------------------------------------------------
// Zod 스키마
// -----------------------------------------------------------------------
const schema = z.object({
  to_ci_id: z.string().min(1, '대상 CI를 선택해주세요.'),
  rel_type: z.string().min(1, '관계 유형을 선택해주세요.'),
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
interface AddRelationshipModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  ciId: string;
}

// -----------------------------------------------------------------------
// AddRelationshipModal
// -----------------------------------------------------------------------
export function AddRelationshipModal({
  open,
  onClose,
  tenantSlug,
  ciId,
}: AddRelationshipModalProps) {
  const queryClient = useQueryClient();
  const [ciSearch, setCiSearch] = useState('');
  const [selectedCI, setSelectedCI] = useState<CI | null>(null);

  const {
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { to_ci_id: '', rel_type: 'depends_on' },
  });

  const relType  = watch('rel_type');
  const toCiId   = watch('to_ci_id');

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

  // 현재 CI 자신 제외
  const filteredCIs = ciList.filter((c) => c.id !== ciId);

  function handleClose() {
    reset();
    setCiSearch('');
    setSelectedCI(null);
    onClose();
  }

  function handleSelectCI(ci: CI) {
    setSelectedCI(ci);
    setValue('to_ci_id', ci.id);
  }

  async function onSubmit(values: FormValues) {
    try {
      await api.post(`/${tenantSlug}/cmdb/cis/${ciId}/relationships`, {
        to_ci_id: values.to_ci_id,
        rel_type: values.rel_type,
      });
      toast.success('관계가 추가되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['cmdb-ci-detail', tenantSlug, ciId] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>관계 추가</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-0">
          <div className="flex flex-col gap-4">
            {/* 대상 CI 검색 */}
            <FormField label="대상 CI" required error={errors.to_ci_id?.message}>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
                <input
                  type="text"
                  value={ciSearch}
                  onChange={(e) => {
                    setCiSearch(e.target.value);
                    setSelectedCI(null);
                    setValue('to_ci_id', '');
                  }}
                  placeholder="CI 이름 또는 IP로 검색..."
                  className="h-9 w-full pl-8 pr-3 rounded-md border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>

              {/* 선택된 CI 표시 */}
              {selectedCI && (
                <div className="flex items-center justify-between rounded-md border border-brand bg-brand/5 px-3 py-2 text-sm">
                  <span className="text-text-primary font-medium">{selectedCI.name}</span>
                  <button
                    type="button"
                    onClick={() => { setSelectedCI(null); setValue('to_ci_id', ''); }}
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
                          toCiId === ci.id && 'bg-surface-hover',
                        )}
                      >
                        <span className="text-text-primary font-medium">{ci.name}</span>
                        <span className="text-xs text-text-disabled ml-2">
                          {typeof ci.ip_address === 'string' ? ci.ip_address : ci.ci_type}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </FormField>

            {/* 관계 유형 */}
            <FormField label="관계 유형" required error={errors.rel_type?.message}>
              <Select value={relType} onValueChange={(v) => setValue('rel_type', v)}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(REL_TYPE_LABELS) as [RelType, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit(onSubmit)} isLoading={isSubmitting} disabled={!toCiId}>
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
