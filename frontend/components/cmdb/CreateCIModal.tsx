'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { Customer, CustomersResponse } from '@/lib/types';
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

// -----------------------------------------------------------------------
// Zod 스키마
// -----------------------------------------------------------------------
const createCISchema = z.object({
  name:         z.string().min(1, '이름을 입력해주세요.').max(200, '200자 이하로 입력해주세요.'),
  ci_type:      z.string().min(1, 'CI 유형을 선택해주세요.'),
  environment:  z.string().min(1, '환경을 선택해주세요.'),
  status:       z.string().min(1, '상태를 선택해주세요.'),
  criticality:  z.string().min(1, '중요도를 선택해주세요.'),
  hostname:     z.string().optional(),
  ip_address:   z.string().optional(),
  os_type:      z.string().optional(),
  os_version:   z.string().optional(),
  customer_id:  z.string().optional(),
  description:  z.string().optional(),
});

type CreateCIValues = z.infer<typeof createCISchema>;

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
interface CreateCIModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

// -----------------------------------------------------------------------
// CreateCIModal
// -----------------------------------------------------------------------
export function CreateCIModal({ open, onClose, tenantSlug }: CreateCIModalProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCIValues>({
    resolver: zodResolver(createCISchema),
    defaultValues: {
      ci_type:     'server',
      environment: 'production',
      status:      'active',
      criticality: 'medium',
    },
  });

  const ciType     = watch('ci_type');
  const environment = watch('environment');
  const status     = watch('status');
  const criticality = watch('criticality');
  const customerId = watch('customer_id');

  // 고객 목록 조회
  const { data: customerData } = useQuery<CustomersResponse>({
    queryKey: ['customers', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/customers`).then((r) => r.data),
    enabled: open && !!tenantSlug,
  });

  const customers: Customer[] = customerData?.items ?? [];

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(values: CreateCIValues) {
    try {
      const payload = {
        name:        values.name,
        ci_type:     values.ci_type,
        environment: values.environment,
        status:      values.status,
        criticality: values.criticality,
        hostname:    values.hostname || null,
        ip_address:  values.ip_address || null,
        os_type:     values.os_type || null,
        os_version:  values.os_version || null,
        customer_id: values.customer_id || null,
        attributes:  values.description ? { description: values.description } : {},
      };
      await api.post(`/${tenantSlug}/cmdb/cis`, payload);
      toast.success('CI가 생성되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['cmdb-cis', tenantSlug] });
      handleClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>새 CI 생성</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-0">
          <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-1">
            {/* 이름 */}
            <FormField label="이름" required error={errors.name?.message}>
              <input
                {...register('name')}
                placeholder="CI 이름"
                className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>

            {/* CI 유형 + 환경 */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="CI 유형" required error={errors.ci_type?.message}>
                <Select value={ciType} onValueChange={(v) => setValue('ci_type', v)}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="server">서버</SelectItem>
                    <SelectItem value="workstation">워크스테이션</SelectItem>
                    <SelectItem value="network_device">네트워크</SelectItem>
                    <SelectItem value="application">애플리케이션</SelectItem>
                    <SelectItem value="service">서비스</SelectItem>
                    <SelectItem value="database">데이터베이스</SelectItem>
                    <SelectItem value="virtual_machine">가상머신</SelectItem>
                    <SelectItem value="cloud_resource">클라우드</SelectItem>
                    <SelectItem value="storage">스토리지</SelectItem>
                    <SelectItem value="firewall">방화벽</SelectItem>
                    <SelectItem value="router_switch">라우터/스위치</SelectItem>
                    <SelectItem value="printer">프린터</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="환경" required error={errors.environment?.message}>
                <Select value={environment} onValueChange={(v) => setValue('environment', v)}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">운영</SelectItem>
                    <SelectItem value="staging">스테이징</SelectItem>
                    <SelectItem value="development">개발</SelectItem>
                    <SelectItem value="test">테스트</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {/* 상태 + 중요도 */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="상태" required error={errors.status?.message}>
                <Select value={status} onValueChange={(v) => setValue('status', v)}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">운영중</SelectItem>
                    <SelectItem value="inactive">비활성</SelectItem>
                    <SelectItem value="maintenance">유지보수</SelectItem>
                    <SelectItem value="decommissioned">폐기</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="중요도" required error={errors.criticality?.message}>
                <Select value={criticality} onValueChange={(v) => setValue('criticality', v)}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">긴급</SelectItem>
                    <SelectItem value="high">높음</SelectItem>
                    <SelectItem value="medium">보통</SelectItem>
                    <SelectItem value="low">낮음</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {/* 호스트명 + IP */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="호스트명" error={errors.hostname?.message}>
                <input
                  {...register('hostname')}
                  placeholder="hostname (선택)"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>

              <FormField label="IP 주소" error={errors.ip_address?.message}>
                <input
                  {...register('ip_address')}
                  placeholder="192.168.0.1 (선택)"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
            </div>

            {/* OS 유형 + OS 버전 */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="OS 유형" error={errors.os_type?.message}>
                <input
                  {...register('os_type')}
                  placeholder="예: Linux, Windows"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>

              <FormField label="OS 버전" error={errors.os_version?.message}>
                <input
                  {...register('os_version')}
                  placeholder="예: Ubuntu 22.04"
                  className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </FormField>
            </div>

            {/* 고객 */}
            <FormField label="고객" error={errors.customer_id?.message}>
              <Select
                value={customerId || 'none'}
                onValueChange={(v) => setValue('customer_id', v === 'none' ? '' : v)}
              >
                <SelectTrigger><SelectValue placeholder="고객 선택 (선택)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">없음</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {typeof c.name === 'string' ? c.name : c.id}
                      {typeof c.company === 'string' && c.company ? ` (${c.company})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {/* 설명 */}
            <FormField label="설명" error={errors.description?.message}>
              <textarea
                {...register('description')}
                rows={3}
                placeholder="CI 설명 (선택)"
                className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled resize-none focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </FormField>
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
