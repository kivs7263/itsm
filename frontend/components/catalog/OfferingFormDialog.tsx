'use client';

/**
 * components/catalog/OfferingFormDialog.tsx — 오퍼링 생성/수정 다이얼로그
 *
 * 엔드포인트 근거: backend/app/routers/service_catalog.py
 *   POST  /{tenant_slug}/service-catalog/offerings              L379-437 (OfferingCreate)
 *   PATCH /{tenant_slug}/service-catalog/offerings/{off_id}      L440-523 (OfferingUpdate)
 *
 * is_system=True 오퍼링 제약(L454-480): name/description/icon/category_id/request_type/
 *   default_priority/default_sla_grade/display_order 수정 시 403 — 해당 필드는
 *   PATCH 바디에서 아예 제외해야 함(값이 None이 아니면 백엔드가 차단 필드로 인식).
 *   form_schema/approval_policy만 항상 수정 가능.
 */

import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormSchemaEditor } from '@/components/catalog/FormSchemaEditor';
import { ApprovalPolicyEditor } from '@/components/catalog/ApprovalPolicyEditor';
import {
  REQUEST_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  SLA_GRADE_OPTIONS,
  type ServiceCategory,
  type ServiceOffering,
  type ServiceFormSchema,
  type ApprovalPolicy,
  type OfferingCreatePayload,
  type OfferingUpdatePayload,
  type OfferingPriority,
  type OfferingSlaGrade,
} from '@/components/catalog/catalogTypes';

function inputCls() {
  return cn(
    'h-9 w-full rounded-md border border-border-default px-2.5 text-sm',
    'bg-surface text-text-primary placeholder:text-text-disabled',
    'focus:outline-none focus:ring-2 focus:ring-accent-500',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  );
}

const EMPTY_FORM_SCHEMA: ServiceFormSchema = { version: '1', fields: [] };
const EMPTY_APPROVAL_POLICY: ApprovalPolicy = { required: false, steps: [] };

type TabId = 'basic' | 'form' | 'approval';

interface OfferingFormDialogProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  categories: ServiceCategory[];
  editing: ServiceOffering | null;
}

export function OfferingFormDialog({
  open,
  onClose,
  tenantSlug,
  categories,
  editing,
}: OfferingFormDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editing;
  const isSystem = !!editing?.is_system;

  const [tab, setTab] = useState<TabId>('basic');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [categoryId, setCategoryId] = useState('__none__');
  const [requestType, setRequestType] = useState('service_request');
  const [defaultPriority, setDefaultPriority] = useState<OfferingPriority>('medium');
  const [defaultSlaGrade, setDefaultSlaGrade] = useState<string>('__none__');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [formSchema, setFormSchema] = useState<ServiceFormSchema>(EMPTY_FORM_SCHEMA);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(EMPTY_APPROVAL_POLICY);

  useEffect(() => {
    if (!open) return;
    setTab('basic');
    if (editing) {
      setCode(editing.code);
      setName(editing.name);
      setDescription(editing.description ?? '');
      setIcon(editing.icon ?? '');
      setCategoryId(editing.category_id ?? '__none__');
      setRequestType(editing.request_type);
      setDefaultPriority(editing.default_priority);
      setDefaultSlaGrade(editing.default_sla_grade ?? '__none__');
      setDisplayOrder(editing.display_order);
      setFormSchema(
        editing.form_schema && Array.isArray(editing.form_schema.fields)
          ? editing.form_schema
          : EMPTY_FORM_SCHEMA,
      );
      setApprovalPolicy(
        editing.approval_policy && typeof editing.approval_policy === 'object'
          ? { required: !!editing.approval_policy.required, steps: editing.approval_policy.steps ?? [] }
          : EMPTY_APPROVAL_POLICY,
      );
    } else {
      setCode('');
      setName('');
      setDescription('');
      setIcon('');
      setCategoryId('__none__');
      setRequestType('service_request');
      setDefaultPriority('medium');
      setDefaultSlaGrade('__none__');
      setDisplayOrder(0);
      setFormSchema(EMPTY_FORM_SCHEMA);
      setApprovalPolicy(EMPTY_APPROVAL_POLICY);
    }
  }, [open, editing]);

  const createMutation = useMutation({
    mutationFn: (payload: OfferingCreatePayload) =>
      api.post(`/${tenantSlug}/service-catalog/offerings`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('오퍼링이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['catalog-offerings', tenantSlug] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: OfferingUpdatePayload) =>
      api
        .patch(`/${tenantSlug}/service-catalog/offerings/${editing?.id}`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('오퍼링이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['catalog-offerings', tenantSlug] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isEdit) {
      if (isSystem) {
        // is_system=True: form_schema / approval_policy 만 전송 (그 외 필드는 403 유발)
        updateMutation.mutate({ form_schema: formSchema, approval_policy: approvalPolicy });
        return;
      }
      if (!name.trim()) {
        toast.error('이름을 입력해주세요.');
        setTab('basic');
        return;
      }
      updateMutation.mutate({
        name,
        description: description || null,
        icon: icon || null,
        category_id: categoryId === '__none__' ? null : categoryId,
        request_type: requestType,
        default_priority: defaultPriority,
        default_sla_grade:
          defaultSlaGrade === '__none__' ? null : (defaultSlaGrade as OfferingSlaGrade),
        form_schema: formSchema,
        approval_policy: approvalPolicy,
        display_order: displayOrder,
      });
      return;
    }

    if (!code.trim() || !name.trim()) {
      toast.error('code와 이름을 입력해주세요.');
      setTab('basic');
      return;
    }
    createMutation.mutate({
      code,
      name,
      description: description || null,
      icon: icon || null,
      category_id: categoryId === '__none__' ? null : categoryId,
      request_type: requestType,
      default_priority: defaultPriority,
      default_sla_grade:
        defaultSlaGrade === '__none__' ? null : (defaultSlaGrade as OfferingSlaGrade),
      form_schema: formSchema,
      approval_policy: approvalPolicy,
      display_order: displayOrder,
    });
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: 'basic', label: '기본 정보' },
    { id: 'form', label: '신청 폼' },
    { id: 'approval', label: '결재선' },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="pb-0">
          <DialogTitle>{isEdit ? '오퍼링 수정' : '오퍼링 추가'}</DialogTitle>
          {isSystem && (
            <p className="flex items-center gap-1.5 text-xs text-warning-text mt-1">
              <Lock size={12} />
              시스템 오퍼링은 신청 폼·결재선만 수정할 수 있습니다.
            </p>
          )}
        </DialogHeader>

        {/* 탭 헤더 */}
        <div className="flex gap-1 px-6 border-b border-border-default shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.id
                  ? 'border-accent-500 text-accent-500'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {tab === 'basic' && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-secondary">
                      code * (생성 후 변경 불가)
                    </label>
                    <input
                      type="text"
                      className={inputCls()}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={isPending || isEdit}
                      placeholder="laptop-request"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-secondary">이름 *</label>
                    <input
                      type="text"
                      className={inputCls()}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={isPending || isSystem}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-secondary">설명</label>
                  <textarea
                    rows={2}
                    className={cn(inputCls(), 'h-auto resize-none py-2')}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isPending || isSystem}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-secondary">카테고리</label>
                    <Select
                      value={categoryId}
                      disabled={isPending || isSystem}
                      onValueChange={setCategoryId}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">없음</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-secondary">요청 유형 *</label>
                    <Select
                      value={requestType}
                      disabled={isPending || isSystem}
                      onValueChange={setRequestType}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REQUEST_TYPE_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-secondary">기본 우선순위</label>
                    <Select
                      value={defaultPriority}
                      disabled={isPending || isSystem}
                      onValueChange={(v) => setDefaultPriority(v as OfferingPriority)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-secondary">기본 SLA 등급</label>
                    <Select
                      value={defaultSlaGrade}
                      disabled={isPending || isSystem}
                      onValueChange={setDefaultSlaGrade}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">없음</SelectItem>
                        {SLA_GRADE_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-secondary">정렬 순서</label>
                    <input
                      type="number"
                      className={inputCls()}
                      value={displayOrder}
                      onChange={(e) => setDisplayOrder(Number(e.target.value) || 0)}
                      disabled={isPending || isSystem}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-secondary">아이콘 (선택)</label>
                  <input
                    type="text"
                    className={inputCls()}
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    disabled={isPending || isSystem}
                  />
                </div>
              </div>
            )}

            {tab === 'form' && (
              <FormSchemaEditor value={formSchema} onChange={setFormSchema} disabled={isPending} />
            )}

            {tab === 'approval' && (
              <ApprovalPolicyEditor
                value={approvalPolicy}
                onChange={setApprovalPolicy}
                disabled={isPending}
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-default shrink-0">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              취소
            </Button>
            <Button type="submit" isLoading={isPending}>
              {isEdit ? '저장' : '추가'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
