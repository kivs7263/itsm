'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  Building2,
  Users,
  FileText,
  Package,
  ScrollText,
  Clock,
  Star,
  Phone,
  Mail,
  Info,
  Cpu,
  Server,
  Wifi,
  HardDrive,
  AppWindow,
  Database,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type {
  Customer,
  CustomerTreeNode,
  CustomerRollup,
  CustomerNote,
  CustomerContact,
  Ticket,
  Asset,
  Contract,
  CI,
} from '@/lib/types';
import { getUser } from '@/lib/auth';
import { isEngineerOrAbove, isTeamLeadOrAbove } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// KPI 스트립
// -----------------------------------------------------------------------
function KpiStrip({ rollup }: { rollup: CustomerRollup }) {
  return (
    <div className="flex items-center gap-6 px-6 py-3 bg-surface-raised border-b border-border-subtle text-sm">
      <span className="text-text-secondary">
        활성 티켓 <strong className="text-text-primary">{rollup.open_tickets}</strong>
      </span>
      <span className="text-text-secondary">
        이번달 공수 <strong className="text-text-primary">{rollup.total_hours_this_month.toFixed(1)}h</strong>
      </span>
      <span className="text-text-secondary">
        자산 <strong className="text-text-primary">{rollup.active_assets}대</strong>
      </span>
      <span className="text-text-secondary">
        계약 <strong className="text-text-primary">{rollup.active_contracts}건</strong>
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------
// 부서 트리
// -----------------------------------------------------------------------
function TreeNode({
  node,
  selectedId,
  onSelect,
  onAddChild,
  depth,
}: {
  node: CustomerTreeNode;
  selectedId: string;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string, parentName: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div className="group relative">
        <button
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors pr-7',
            selectedId === node.id
              ? 'bg-surface-selected text-text-primary font-medium'
              : 'text-text-secondary hover:bg-surface-hover',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onSelect(node.id)}
        >
          {hasChildren ? (
            <span
              className="shrink-0"
              onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {node.kind === 'account' ? (
            <Building2 size={13} className="shrink-0" />
          ) : (
            <Users size={13} className="shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        <button
          type="button"
          title="하위 부서 추가"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center w-5 h-5 rounded hover:bg-surface-raised text-text-disabled hover:text-text-primary transition-colors"
          onClick={(e) => { e.stopPropagation(); onAddChild(node.id, node.name); }}
        >
          <Plus size={11} />
        </button>
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------
// 탭: 고객 정보 (InfoTab) — 기본 정보 수정 + 연락처 통합
// -----------------------------------------------------------------------
interface ContactFormState {
  name: string;
  role: string;
  email: string;
  phone: string;
  is_primary: boolean;
  memo: string;
}

const EMPTY_FORM: ContactFormState = {
  name: '',
  role: '',
  email: '',
  phone: '',
  is_primary: false,
  memo: '',
};

interface InfoFormState {
  name: string;
  company: string;
  email: string;
  phone: string;
  contract_grade: string;
  kind: string;
}

function InfoTab({
  tenantSlug,
  customerId,
  customer,
  onCustomerUpdated,
}: {
  tenantSlug: string;
  customerId: string;
  customer: Customer;
  onCustomerUpdated: () => void;
}) {
  const queryClient = useQueryClient();
  const user = getUser();
  const canWrite = isEngineerOrAbove(user?.role);
  const canDelete = isTeamLeadOrAbove(user?.role);

  // ---- 기본 정보 편집 ----
  const [isEditing, setIsEditing] = useState(false);
  const [infoForm, setInfoForm] = useState<InfoFormState>({
    name: customer.name ?? '',
    company: (customer as { company?: string }).company ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    contract_grade: customer.contract_grade ?? '',
    kind: customer.kind ?? 'account',
  });

  useEffect(() => {
    setInfoForm({
      name: customer.name ?? '',
      company: (customer as { company?: string }).company ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      contract_grade: customer.contract_grade ?? '',
      kind: customer.kind ?? 'account',
    });
  }, [customer]);

  const patchMutation = useMutation({
    mutationFn: (data: Partial<InfoFormState>) =>
      api.patch(`/${tenantSlug}/customers/${customerId}`, data).then((r) => r.data),
    onSuccess: () => {
      toast.success('고객 정보가 수정되었습니다.');
      setIsEditing(false);
      onCustomerUpdated();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const inputCls = 'h-8 w-full rounded-md border border-border-default bg-surface px-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong';

  // ---- 연락처 ----
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ContactFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ContactFormState>(EMPTY_FORM);

  const CONTACTS_KEY = ['customer-contacts', tenantSlug, customerId] as const;

  const { data: contactsData, isLoading: contactsLoading } = useQuery<CustomerContact[]>({
    queryKey: CONTACTS_KEY,
    queryFn: () =>
      api.get(`/${tenantSlug}/customers/${customerId}/contacts`).then((r) => {
        const d = r.data;
        return Array.isArray(d) ? d : (d?.items ?? []);
      }),
  });

  const contacts = contactsData ?? [];

  const createContactMutation = useMutation({
    mutationFn: (body: ContactFormState) =>
      api.post(`/${tenantSlug}/customers/${customerId}/contacts`, {
        name: body.name,
        role: body.role || null,
        email: body.email || null,
        phone: body.phone || null,
        is_primary: body.is_primary,
        memo: body.memo || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
      setShowAddForm(false);
      setAddForm(EMPTY_FORM);
      toast.success('연락처가 추가되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateContactMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ContactFormState }) =>
      api.patch(`/${tenantSlug}/customers/${customerId}/contacts/${id}`, {
        name: body.name,
        role: body.role || null,
        email: body.email || null,
        phone: body.phone || null,
        is_primary: body.is_primary,
        memo: body.memo || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
      setEditingId(null);
      toast.success('연락처가 수정되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteContactMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/${tenantSlug}/customers/${customerId}/contacts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
      toast.success('연락처가 삭제되었습니다.');
    },
    onError: (err) => {
      const msg = getErrorMessage(err);
      if (msg.toLowerCase().includes('primary') || (err as { response?: { status?: number } })?.response?.status === 400) {
        toast.error('다른 주 연락처를 지정한 후 삭제하세요.');
      } else {
        toast.error(msg);
      }
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/${tenantSlug}/customers/${customerId}/contacts/${id}/set-primary`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
      toast.success('주 연락처로 지정되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function startEdit(contact: CustomerContact) {
    setEditingId(contact.id);
    setEditForm({
      name: contact.name,
      role: contact.role ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      is_primary: contact.is_primary,
      memo: contact.memo ?? '',
    });
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl">
      {/* ---- 고객 기본 정보 카드 ---- */}
      <div className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base text-text-primary">{customer.name}</span>
            <span className="text-xs text-text-disabled bg-surface-raised border border-border-subtle rounded px-2 py-0.5">
              {customer.kind === 'account' ? '고객사' : '부서'}
            </span>
            {customer.contract_grade && (
              <span className="text-xs font-medium text-text-secondary bg-surface-raised border border-border-subtle rounded-full px-2 py-0.5 capitalize">
                {customer.contract_grade}
              </span>
            )}
          </div>
          {!isEditing && canWrite && (
            <button
              onClick={() => setIsEditing(true)}
              className="shrink-0 p-1.5 rounded hover:bg-surface-hover text-text-disabled hover:text-text-secondary transition-colors"
              title="편집"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-text-secondary mb-1 block">이름 *</label>
                <input
                  className={inputCls}
                  value={infoForm.name}
                  onChange={(e) => setInfoForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">회사명</label>
                <input
                  className={inputCls}
                  value={infoForm.company}
                  onChange={(e) => setInfoForm((f) => ({ ...f, company: e.target.value }))}
                  placeholder="Samsung Electronics"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">이메일</label>
                <input
                  type="email"
                  className={inputCls}
                  value={infoForm.email}
                  onChange={(e) => setInfoForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="contact@company.com"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">전화</label>
                <input
                  type="tel"
                  className={inputCls}
                  value={infoForm.phone}
                  onChange={(e) => setInfoForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="02-1234-5678"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">계약 등급</label>
                <select
                  className={inputCls}
                  value={infoForm.contract_grade}
                  onChange={(e) => setInfoForm((f) => ({ ...f, contract_grade: e.target.value }))}
                >
                  <option value="">없음</option>
                  <option value="bronze">Bronze</option>
                  <option value="silver">Silver</option>
                  <option value="gold">Gold</option>
                  <option value="platinum">Platinum</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">종류</label>
                <select
                  className={inputCls}
                  value={infoForm.kind}
                  onChange={(e) => setInfoForm((f) => ({ ...f, kind: e.target.value }))}
                >
                  <option value="account">최상위 고객사</option>
                  <option value="division">하위 부서</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setInfoForm({ name: customer.name ?? '', company: (customer as { company?: string }).company ?? '', email: customer.email ?? '', phone: customer.phone ?? '', contract_grade: customer.contract_grade ?? '', kind: customer.kind ?? 'account' }); }}>
                취소
              </Button>
              <Button
                size="sm"
                disabled={!infoForm.name.trim()}
                onClick={() => patchMutation.mutate(infoForm)}
                isLoading={patchMutation.isPending}
              >
                저장
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            {(customer as { company?: string }).company && (
              <div className="col-span-2">
                <dt className="text-xs text-text-secondary">회사</dt>
                <dd className="mt-0.5 text-sm text-text-primary">{(customer as { company?: string }).company}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-text-secondary">이메일</dt>
              <dd className="mt-0.5 text-sm text-text-primary">{customer.email ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">전화</dt>
              <dd className="mt-0.5 text-sm text-text-primary">{customer.phone ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">생성</dt>
              <dd className="mt-0.5 text-sm text-text-primary">{formatRelativeTime(customer.created_at)}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* ---- 구분선 + 담당 연락처 섹션 ---- */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">담당 연락처</h3>
          {canWrite && !showAddForm && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Plus size={13} />}
              onClick={() => setShowAddForm(true)}
            >
              연락처 추가
            </Button>
          )}
        </div>

        {/* 추가 폼 */}
        {showAddForm && (
          <div className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 flex flex-col gap-3 mb-3">
            <p className="text-sm font-medium text-text-primary">새 연락처</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-text-secondary mb-1 block">이름 *</label>
                <input
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="홍길동"
                  className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">직책 (선택)</label>
                <input
                  value={addForm.role}
                  onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
                  placeholder="IT 담당자"
                  className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">이메일 (선택)</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="name@company.com"
                  className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">전화 (선택)</label>
                <input
                  type="tel"
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="010-1234-5678"
                  className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">메모 (선택)</label>
                <input
                  value={addForm.memo}
                  onChange={(e) => setAddForm((f) => ({ ...f, memo: e.target.value }))}
                  placeholder="추가 메모"
                  className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="add-primary"
                  type="checkbox"
                  checked={addForm.is_primary}
                  onChange={(e) => setAddForm((f) => ({ ...f, is_primary: e.target.checked }))}
                  className="rounded border-border-default"
                />
                <label htmlFor="add-primary" className="text-sm text-text-secondary cursor-pointer">
                  주 연락처
                </label>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
              >
                취소
              </Button>
              <Button
                size="sm"
                disabled={!addForm.name.trim()}
                onClick={() => createContactMutation.mutate(addForm)}
                isLoading={createContactMutation.isPending}
              >
                저장
              </Button>
            </div>
          </div>
        )}

        {contactsLoading && (
          <div className="p-3">
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!contactsLoading && contacts.length === 0 && !showAddForm && (
          <div className="flex flex-col items-center justify-center py-10 text-text-secondary text-sm">
            등록된 연락처가 없습니다.
          </div>
        )}

        {/* 연락처 카드 목록 */}
        <div className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4"
            >
              {editingId === contact.id ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-text-primary">연락처 수정</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-xs text-text-secondary mb-1 block">이름 *</label>
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">직책</label>
                      <input
                        value={editForm.role}
                        onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                        className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">이메일</label>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                        className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">전화</label>
                      <input
                        type="tel"
                        value={editForm.phone}
                        onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                        className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">메모</label>
                      <input
                        value={editForm.memo}
                        onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
                        className="h-8 w-full rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id={`edit-primary-${contact.id}`}
                        type="checkbox"
                        checked={editForm.is_primary}
                        onChange={(e) => setEditForm((f) => ({ ...f, is_primary: e.target.checked }))}
                        className="rounded border-border-default"
                      />
                      <label
                        htmlFor={`edit-primary-${contact.id}`}
                        className="text-sm text-text-secondary cursor-pointer"
                      >
                        주 연락처
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      취소
                    </Button>
                    <Button
                      size="sm"
                      disabled={!editForm.name.trim()}
                      onClick={() => updateContactMutation.mutate({ id: contact.id, body: editForm })}
                      isLoading={updateContactMutation.isPending}
                    >
                      저장
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-text-primary">{contact.name}</span>
                      {contact.is_primary && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          <Star size={10} className="fill-green-600 text-green-600" />
                          주 연락처
                        </span>
                      )}
                      {contact.role && (
                        <span className="text-xs text-text-disabled">{contact.role}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {contact.email && (
                        <a
                          href={`mailto:${contact.email}`}
                          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <Mail size={11} />
                          {contact.email}
                        </a>
                      )}
                      {contact.phone && (
                        <a
                          href={`tel:${contact.phone}`}
                          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <Phone size={11} />
                          {contact.phone}
                        </a>
                      )}
                    </div>
                    {contact.memo && (
                      <p className="mt-1.5 text-xs text-text-disabled leading-relaxed">
                        {contact.memo}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {canWrite && !contact.is_primary && (
                      <button
                        title="주 연락처로 지정"
                        onClick={() => setPrimaryMutation.mutate(contact.id)}
                        className="p-1.5 rounded hover:bg-surface-hover text-text-disabled hover:text-yellow-500 transition-colors"
                      >
                        <Star size={13} />
                      </button>
                    )}
                    {canWrite && (
                      <button
                        title="수정"
                        onClick={() => startEdit(contact)}
                        className="p-1.5 rounded hover:bg-surface-hover text-text-disabled hover:text-text-secondary transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        title="삭제"
                        onClick={() => deleteContactMutation.mutate(contact.id)}
                        className="p-1.5 rounded hover:bg-error-bg text-text-disabled hover:text-error-text transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭: 인프라 (InfraTab) — CMDB CI + Assets 통합
// -----------------------------------------------------------------------
const HW_TYPES = new Set(['server', 'network_device', 'storage', 'firewall', 'router_switch', 'workstation']);
const SW_TYPES = new Set(['application', 'database', 'middleware', 'service', 'virtual_machine', 'cloud_resource']);

const STATUS_COLORS: Record<string, string> = {
  active:         'bg-status-resolved-bg text-status-resolved',
  maintenance:    'bg-warning-bg text-warning-text',
  inactive:       'bg-error-bg text-error-text',
  decommissioned: 'bg-border-subtle text-text-disabled',
};
const STATUS_LABELS: Record<string, string> = {
  active: '운영중', maintenance: '점검중', inactive: '중단', decommissioned: '폐기',
};

function getCiIcon(ciType: string) {
  if (ciType === 'server' || ciType === 'workstation') return <Server size={14} className="shrink-0 text-text-secondary" />;
  if (ciType === 'network_device' || ciType === 'firewall' || ciType === 'router_switch') return <Wifi size={14} className="shrink-0 text-text-secondary" />;
  if (ciType === 'storage') return <HardDrive size={14} className="shrink-0 text-text-secondary" />;
  if (ciType === 'application' || ciType === 'service') return <AppWindow size={14} className="shrink-0 text-text-secondary" />;
  if (ciType === 'database') return <Database size={14} className="shrink-0 text-text-secondary" />;
  return <Layers size={14} className="shrink-0 text-text-secondary" />;
}

type InfraFilter = 'all' | 'hw' | 'sw' | 'asset';

function InfraTab({ tenantSlug, customerId }: { tenantSlug: string; customerId: string }) {
  const [filter, setFilter] = useState<InfraFilter>('all');

  const { data: ciData, isLoading: ciLoading } = useQuery({
    queryKey: ['customer-cis', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/cmdb`, { params: { customer_id: customerId, page_size: 100 } })
        .then((r) => r.data),
  });

  const { data: assetData, isLoading: assetLoading } = useQuery({
    queryKey: ['customer-assets', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/assets`, { params: { customer_id: customerId, page_size: 100 } })
        .then((r) => r.data),
  });

  const cis: CI[] = ciData?.items ?? [];
  const assets: Asset[] = assetData?.items ?? [];

  const hwCis = cis.filter((ci) => HW_TYPES.has(ci.ci_type));
  const swCis = cis.filter((ci) => SW_TYPES.has(ci.ci_type));

  const isLoading = ciLoading || assetLoading;

  if (isLoading) {
    return (
      <div className="p-6 flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const filterTabs: { id: InfraFilter; label: string }[] = [
    { id: 'all', label: `전체 (${cis.length + assets.length})` },
    { id: 'hw', label: `HW (${hwCis.length})` },
    { id: 'sw', label: `SW (${swCis.length})` },
    { id: 'asset', label: `자산 (${assets.length})` },
  ];

  const showCis = filter === 'all' || filter === 'hw' || filter === 'sw';
  const showAssets = filter === 'all' || filter === 'asset';

  const displayCis = filter === 'hw' ? hwCis : filter === 'sw' ? swCis : cis;

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* 상태 요약 바 */}
      <div className="flex gap-4 px-6 py-4 border-b border-border-subtle bg-surface-raised shrink-0">
        <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-surface border border-border-subtle">
          <span className="text-xl font-bold text-text-primary">{hwCis.length}</span>
          <span className="text-xs text-text-secondary mt-0.5">HW 총 {hwCis.length}대</span>
        </div>
        <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-surface border border-border-subtle">
          <span className="text-xl font-bold text-text-primary">{swCis.length}</span>
          <span className="text-xs text-text-secondary mt-0.5">SW 총 {swCis.length}개</span>
        </div>
        <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-surface border border-border-subtle">
          <span className="text-xl font-bold text-text-primary">{assets.length}</span>
          <span className="text-xs text-text-secondary mt-0.5">자산 {assets.length}개</span>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 px-4 py-2 border-b border-border-subtle shrink-0">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md transition-colors',
              filter === tab.id
                ? 'bg-surface-selected text-text-primary font-medium'
                : 'text-text-secondary hover:bg-surface-hover',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 아이템 목록 */}
      <div className="flex-1 divide-y divide-border-subtle">
        {showCis && displayCis.map((ci) => (
          <div key={`ci-${ci.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover">
            {getCiIcon(ci.ci_type)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary truncate">{ci.name}</span>
                <span className="text-xs text-text-disabled shrink-0">{ci.ci_type}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                {ci.hostname && (
                  <span className="text-xs text-text-secondary">{ci.hostname}</span>
                )}
                {ci.ip_address && (
                  <span className="text-xs text-text-disabled font-mono">{ci.ip_address}</span>
                )}
                {ci.environment && (
                  <span className="text-xs text-text-disabled capitalize">{ci.environment}</span>
                )}
              </div>
            </div>
            {ci.status && (
              <span className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS_COLORS[ci.status] ?? 'bg-border-subtle text-text-disabled',
              )}>
                {STATUS_LABELS[ci.status] ?? ci.status}
              </span>
            )}
          </div>
        ))}

        {showAssets && assets.map((a) => (
          <div key={`asset-${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover">
            <Package size={14} className="shrink-0 text-text-secondary" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary truncate">{a.model}</span>
                <span className="text-xs text-text-disabled shrink-0">{a.asset_type}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                {a.asset_tag && (
                  <span className="text-xs font-mono text-text-secondary">{a.asset_tag}</span>
                )}
                {a.warranty_end && (
                  <span className="text-xs text-text-disabled">보증만료 {formatRelativeTime(a.warranty_end)}</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {(filter === 'all' ? (cis.length + assets.length) : filter === 'hw' ? hwCis.length : filter === 'sw' ? swCis.length : assets.length) === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-secondary text-sm">
            등록된 항목이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭: 티켓
// -----------------------------------------------------------------------
// -----------------------------------------------------------------------
// 지원 이력 타임라인 — 유틸
// -----------------------------------------------------------------------
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

interface SupportHistoryItem {
  id: string;
  ticket_number: string | null;
  title: string;
  request_type: string | null;
  status: string;
  priority: string;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  total_hours: number;
  billable_hours: number;
  escalation_count: number;
  escalation_team_names: string[];
  assigned_user_name: string | null;
  contract_name: string | null;
  linked_kb_article_id: string | null;
}

interface SupportHistoryResponse {
  items: SupportHistoryItem[];
  total: number;
}

type SupportHistoryFilter = 'all' | 'active' | 'done';

const REQUEST_TYPE_BADGE: Record<string, string> = {
  incident: 'bg-red-100 text-red-700',
  installation: 'bg-blue-100 text-blue-700',
  upgrade: 'bg-purple-100 text-purple-700',
  service_request: 'bg-green-100 text-green-700',
  maintenance: 'bg-gray-100 text-gray-600',
  technical_inquiry: 'bg-gray-100 text-gray-600',
};

const REQUEST_TYPE_LABEL: Record<string, string> = {
  incident: '장애 지원',
  installation: '설치',
  upgrade: '업그레이드',
  service_request: '서비스 요청',
  maintenance: '유지보수',
  technical_inquiry: '기술 문의',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  pending: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL: Record<string, string> = {
  open: '접수',
  in_progress: '처리 중',
  pending: '대기',
  resolved: '해결',
  closed: '종료',
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: '긴급',
  high: '높음',
  medium: '보통',
  low: '낮음',
};

const STATUS_LEFT_BORDER: Record<string, string> = {
  open: 'border-l-4 border-l-blue-500',
  in_progress: 'border-l-4 border-l-blue-500',
  pending: 'border-l-4 border-l-amber-400',
  resolved: 'border-l-4 border-l-green-500',
  closed: 'border-l-4 border-l-green-500',
};

function SupportHistoryCard({ item, tenantSlug }: { item: SupportHistoryItem; tenantSlug: string }) {
  const router = useRouter();
  const borderClass = STATUS_LEFT_BORDER[item.status] ?? 'border-l-4 border-l-gray-300';
  const requestBadge = REQUEST_TYPE_BADGE[item.request_type ?? ''] ?? 'bg-gray-100 text-gray-600';
  const requestLabel = REQUEST_TYPE_LABEL[item.request_type ?? ''] ?? item.request_type ?? '';
  const statusBadge = STATUS_BADGE[item.status] ?? 'bg-gray-100 text-gray-600';
  const statusLabel = STATUS_LABEL[item.status] ?? item.status;
  const priorityBadge = PRIORITY_BADGE[item.priority] ?? 'bg-gray-100 text-gray-600';
  const priorityLabel = PRIORITY_LABEL[item.priority] ?? item.priority;

  const endDate = item.resolved_at ?? item.closed_at;
  const dateRange = endDate
    ? `${fmtDate(item.created_at)} → ${fmtDate(endDate)}`
    : `${fmtDate(item.created_at)} → 진행 중`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/${tenantSlug}/tickets/${item.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') router.push(`/${tenantSlug}/tickets/${item.id}`); }}
      className={cn('bg-surface-raised rounded-lg p-4 cursor-pointer hover:bg-surface-hover transition-colors', borderClass)}
    >
      {/* 상단 행: 뱃지들 + 티켓 번호 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.request_type && (
            <span className={cn('px-2 py-0.5 rounded text-xs font-medium', requestBadge)}>
              {requestLabel}
            </span>
          )}
          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', statusBadge)}>
            {statusLabel}
          </span>
          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', priorityBadge)}>
            {priorityLabel}
          </span>
        </div>
        {item.ticket_number && (
          <span className="text-xs font-mono text-text-secondary shrink-0">
            {item.ticket_number}
          </span>
        )}
      </div>

      {/* 제목 */}
      <p className="text-sm font-medium text-text-primary mb-2">{item.title}</p>

      {/* 날짜/기간 */}
      <p className="text-xs text-text-secondary mb-1.5">
        <span className="mr-1">🗓</span>
        {dateRange}
        {item.total_hours > 0 && (
          <span className="ml-1.5 text-text-secondary">({item.total_hours}h 공수)</span>
        )}
      </p>

      {/* 담당자 / 계약 */}
      {(item.assigned_user_name || item.contract_name) && (
        <p className="text-xs text-text-secondary mb-1.5">
          {item.assigned_user_name && (
            <span className="mr-3"><span className="mr-1">👤</span>{item.assigned_user_name}</span>
          )}
          {item.contract_name && (
            <span><span className="mr-1">📄</span>{item.contract_name}</span>
          )}
        </p>
      )}

      {/* 에스컬레이션 / KB */}
      {(item.escalation_count > 0 || item.linked_kb_article_id) && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {item.escalation_count > 0 && item.escalation_team_names.length > 0 && (
            item.escalation_team_names.map((name) => (
              <span
                key={name}
                className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700"
              >
                에스컬레이션: {name}
              </span>
            ))
          )}
          {item.linked_kb_article_id && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
              KB 연결
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TicketsTab({ tenantSlug, customerId }: { tenantSlug: string; customerId: string }) {
  const [filter, setFilter] = useState<SupportHistoryFilter>('all');

  const { data, isLoading } = useQuery<SupportHistoryResponse>({
    queryKey: ['customer-support-history', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/customers/${customerId}/support-history`)
        .then((r) => r.data),
  });

  const allItems: SupportHistoryItem[] = data?.items ?? [];
  const total = data?.total ?? 0;

  const filteredItems = allItems.filter((item) => {
    if (filter === 'active') return ['open', 'in_progress', 'pending'].includes(item.status);
    if (filter === 'done') return ['resolved', 'closed'].includes(item.status);
    return true;
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* 상단: 건수 + 필터 */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-text-secondary">
          지원 이력 <strong className="text-text-primary">{total}건</strong>
        </span>
        <div className="flex items-center gap-1 bg-surface-raised rounded-lg p-1">
          {([
            { value: 'all', label: '전체' },
            { value: 'active', label: '진행 중' },
            { value: 'done', label: '완료' },
          ] as { value: SupportHistoryFilter; label: string }[]).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                filter === value
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary text-sm">
          지원 이력이 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => (
            <SupportHistoryCard key={item.id} item={item} tenantSlug={tenantSlug} />
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭: 계약 (생성·수정·삭제 포함)
// -----------------------------------------------------------------------
const CONTRACT_TYPE_LABELS: Record<string, string> = {
  warranty: '보증', paid: '유상', maintenance: '유지보수',
};

function ContractsTab({ tenantSlug, customerId }: { tenantSlug: string; customerId: string }) {
  const queryClient = useQueryClient();
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const emptyForm = { name: '', type: 'maintenance', sla_grade: 'standard', start_date: '', end_date: '', amount: '', memo: '', linked_business_id: '' };
  const [form, setForm] = useState({ ...emptyForm });

  const { data, isLoading } = useQuery({
    queryKey: ['customer-contracts', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/contracts`, { params: { customer_id: customerId, page_size: 50 } })
        .then((r) => r.data),
  });

  const contracts: Contract[] = data?.items ?? [];

  // SA 사업카드 목록
  const { data: businessesData } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['businesses', tenantSlug],
    queryFn: () => api.get(`/${tenantSlug}/businesses`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const businesses = businessesData ?? [];

  const createMutation = useMutation({
    mutationFn: (d: typeof form) =>
      api.post(`/${tenantSlug}/contracts`, {
        name: d.name, customer_id: customerId, type: d.type,
        sla_grade: d.sla_grade, start_date: d.start_date, end_date: d.end_date,
        amount: d.amount ? Number(d.amount) : null, memo: d.memo || null,
        linked_business_id: d.linked_business_id || null,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('계약이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['customer-contracts', tenantSlug, customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-rollup', tenantSlug, customerId] });
      setShowCreate(false);
      setForm({ ...emptyForm });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, d }: { id: string; d: typeof form }) =>
      api.patch(`/${tenantSlug}/contracts/${id}`, {
        name: d.name, type: d.type, sla_grade: d.sla_grade,
        start_date: d.start_date, end_date: d.end_date,
        amount: d.amount ? Number(d.amount) : null, memo: d.memo || null,
        linked_business_id: d.linked_business_id || null,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('계약이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['customer-contracts', tenantSlug, customerId] });
      setEditContract(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/${tenantSlug}/contracts/${id}`),
    onSuccess: () => {
      toast.success('계약이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['customer-contracts', tenantSlug, customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-rollup', tenantSlug, customerId] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function openEdit(c: Contract) {
    setEditContract(c);
    setForm({ name: c.name, type: c.type, sla_grade: c.sla_grade, start_date: c.start_date, end_date: c.end_date, amount: c.amount ?? '', memo: c.memo ?? '', linked_business_id: c.linked_business_id ?? '' });
  }

  const inputCls = 'h-8 w-full rounded-md border border-border-default bg-surface px-2.5 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong';

  const ContractForm = ({ onSubmit, onCancel, loading }: { onSubmit: () => void; onCancel: () => void; loading: boolean }) => (
    <div className="grid grid-cols-2 gap-3 p-4 bg-surface-raised border-b border-border-subtle">
      <div className="col-span-2">
        <label className="text-xs text-text-secondary mb-1 block">계약명 *</label>
        <input className={inputCls} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="삼성전자 서버 유지보수 계약" />
      </div>
      <div>
        <label className="text-xs text-text-secondary mb-1 block">유형 *</label>
        <select className={inputCls} value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
          {Object.entries(CONTRACT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-text-secondary mb-1 block">SLA 등급 *</label>
        <input className={inputCls} value={form.sla_grade} onChange={(e) => setForm((p) => ({ ...p, sla_grade: e.target.value }))} placeholder="standard / premium" />
      </div>
      <div>
        <label className="text-xs text-text-secondary mb-1 block">시작일 *</label>
        <input type="date" className={inputCls} value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
      </div>
      <div>
        <label className="text-xs text-text-secondary mb-1 block">만료일 *</label>
        <input type="date" className={inputCls} value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} />
      </div>
      <div>
        <label className="text-xs text-text-secondary mb-1 block">금액</label>
        <input type="number" className={inputCls} value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0" />
      </div>
      <div>
        <label className="text-xs text-text-secondary mb-1 block">메모</label>
        <input className={inputCls} value={form.memo} onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))} placeholder="비고 (선택)" />
      </div>
      <div className="col-span-2">
        <label className="text-xs text-text-secondary mb-1 block">SA 사업카드 연결</label>
        <select className={inputCls} value={form.linked_business_id} onChange={(e) => setForm((p) => ({ ...p, linked_business_id: e.target.value }))}>
          <option value="">연결 안 함</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <div className="col-span-2 flex gap-2 pt-1">
        <Button size="sm" onClick={onSubmit} isLoading={loading} disabled={!form.name || !form.start_date || !form.end_date}>저장</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>취소</Button>
      </div>
    </div>
  );

  if (isLoading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-xs text-text-secondary">{contracts.length}개</span>
        <Button size="sm" leftIcon={<Plus size={12} />} onClick={() => { setShowCreate(true); setEditContract(null); }}>
          계약 추가
        </Button>
      </div>

      {/* 생성 폼 */}
      {showCreate && (
        <ContractForm
          onSubmit={() => createMutation.mutate(form)}
          onCancel={() => setShowCreate(false)}
          loading={createMutation.isPending}
        />
      )}

      {contracts.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary text-sm">
          연결된 계약이 없습니다.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface border-b border-border-default">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">계약명</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">유형</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">SLA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">기간</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">SA 사업카드</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary">액션</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => {
              const linkedBiz = c.linked_business_id
                ? businesses.find((b) => b.id === c.linked_business_id)
                : null;
              return (
                <React.Fragment key={c.id}>
                  <tr className="border-b border-border-subtle hover:bg-surface-hover">
                    <td className="px-4 py-2.5 text-text-primary font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {CONTRACT_TYPE_LABELS[c.type] ?? c.type}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary text-xs">{c.sla_grade}</td>
                    <td className="px-4 py-2.5 text-text-secondary text-xs">
                      {c.start_date} ~ {c.end_date}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {linkedBiz
                        ? <span className="text-text-primary font-medium">{linkedBiz.name}</span>
                        : <span className="text-text-disabled">-</span>
                      }
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openEdit(c)} className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover">
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { if (confirm('계약을 삭제하시겠습니까?')) deleteMutation.mutate(c.id); }}
                          className="p-1 rounded text-text-secondary hover:text-error hover:bg-error-bg"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editContract?.id === c.id && (
                    <tr className="border-b border-border-subtle">
                      <td colSpan={6} className="p-0">
                        <ContractForm
                          onSubmit={() => updateMutation.mutate({ id: c.id, d: form })}
                          onCancel={() => setEditContract(null)}
                          loading={updateMutation.isPending}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭: 메모
// -----------------------------------------------------------------------
function NotesTab({
  tenantSlug,
  customerId,
}: {
  tenantSlug: string;
  customerId: string;
}) {
  const queryClient = useQueryClient();
  const [editingNote, setEditingNote] = useState<CustomerNote | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data: notes = [], isLoading } = useQuery<CustomerNote[]>({
    queryKey: ['customer-notes', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/customers/${customerId}/notes`).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (d: { title: string; content: string }) =>
      api.post(`/${tenantSlug}/customers/${customerId}/notes`, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-notes', tenantSlug, customerId] });
      setShowForm(false);
      setNewTitle('');
      setNewContent('');
      toast.success('메모가 저장되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (d: { note_id: string; title: string; content: string }) =>
      api.patch(`/${tenantSlug}/customers/${customerId}/notes/${d.note_id}`, {
        title: d.title,
        content: d.content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-notes', tenantSlug, customerId] });
      setEditingNote(null);
      toast.success('메모가 수정되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) =>
      api.delete(`/${tenantSlug}/customers/${customerId}/notes/${noteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-notes', tenantSlug, customerId] });
      toast.success('메모가 삭제되었습니다.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;

  return (
    <div className="p-6 flex flex-col gap-4">
      {/* 새 메모 폼 */}
      {showForm && (
        <div className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4 flex flex-col gap-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="제목 (선택)"
            className="h-8 rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="내용을 입력하세요 (Markdown 지원)"
            rows={5}
            className="rounded-md border border-border-default bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong resize-y"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>취소</Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate({ title: newTitle, content: newContent })}
              isLoading={createMutation.isPending}
            >
              저장
            </Button>
          </div>
        </div>
      )}

      {/* 새 메모 버튼 */}
      {!showForm && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Plus size={13} />}
          className="self-start"
          onClick={() => setShowForm(true)}
        >
          새 메모
        </Button>
      )}

      {/* 메모 목록 */}
      {notes.length === 0 && !showForm && (
        <p className="text-sm text-text-secondary py-8 text-center">작성된 메모가 없습니다.</p>
      )}

      {notes.map((note) => (
        <div key={note.id} className="bg-white border border-[var(--color-border)] rounded-[16px] shadow-[var(--shadow-card)] p-4">
          {editingNote?.id === note.id ? (
            <div className="flex flex-col gap-3">
              <input
                value={editingNote.title ?? ''}
                onChange={(e) => setEditingNote({ ...editingNote, title: e.target.value })}
                className="h-8 rounded-md border border-border-default bg-transparent px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
              <textarea
                value={editingNote.content ?? ''}
                onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                rows={5}
                className="rounded-md border border-border-default bg-transparent px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-strong resize-y"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setEditingNote(null)}>취소</Button>
                <Button
                  size="sm"
                  onClick={() =>
                    updateMutation.mutate({
                      note_id: note.id,
                      title: editingNote.title ?? '',
                      content: editingNote.content ?? '',
                    })
                  }
                  isLoading={updateMutation.isPending}
                >
                  저장
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  {note.title && (
                    <p className="font-medium text-sm text-text-primary">{note.title}</p>
                  )}
                  <p className="text-xs text-text-disabled mt-0.5">
                    {formatRelativeTime(note.updated_at)}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setEditingNote(note)}
                    className="p-1 rounded hover:bg-surface-hover text-text-disabled hover:text-text-secondary transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(note.id)}
                    className="p-1 rounded hover:bg-error-bg text-text-disabled hover:text-error-text transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {note.content && (
                <p className="mt-2 text-sm text-text-secondary whitespace-pre-wrap">{note.content}</p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭 정의
// -----------------------------------------------------------------------
const TABS = [
  { id: 'info',      label: '고객 정보', icon: Info },
  { id: 'tickets',   label: '티켓',     icon: ScrollText },
  { id: 'infra',     label: '인프라',   icon: Cpu },
  { id: 'contracts', label: '계약',     icon: FileText },
  { id: 'notes',     label: '메모',     icon: Clock },
] as const;

type TabId = typeof TABS[number]['id'];

// -----------------------------------------------------------------------
// 고객 360도 상세 페이지
// -----------------------------------------------------------------------
export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tenantSlug = params?.tenantSlug as string;
  const customerId = params?.customerId as string;

  const [activeTab, setActiveTab] = useState<TabId>('info');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(customerId);
  const [addDivision, setAddDivision] = useState<{ parentId: string; parentName: string } | null>(null);
  const [newDivisionName, setNewDivisionName] = useState('');

  const addDivisionMutation = useMutation({
    mutationFn: ({ parentId, name }: { parentId: string; name: string }) =>
      api.post(`/${tenantSlug}/customers/${parentId}/divisions`, { name }),
    onSuccess: (res) => {
      toast.success('하위 부서가 추가되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['customer-tree', tenantSlug, customerId] });
      setSelectedNodeId(res.data.id);
      setAddDivision(null);
      setNewDivisionName('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const { data: customer, isLoading: customerLoading } = useQuery<Customer>({
    queryKey: ['customer', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/customers/${customerId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!customerId,
  });

  const { data: tree, isLoading: treeLoading } = useQuery<CustomerTreeNode[]>({
    queryKey: ['customer-tree', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/customers/${customerId}/tree`).then((r) => r.data),
    enabled: !!tenantSlug && !!customerId,
  });

  const { data: rollup } = useQuery<CustomerRollup>({
    queryKey: ['customer-rollup', tenantSlug, selectedNodeId],
    queryFn: () =>
      api.get(`/${tenantSlug}/customers/${selectedNodeId}/rollup`).then((r) => r.data),
    enabled: !!tenantSlug && !!selectedNodeId,
  });

  const { data: selectedCustomer } = useQuery<Customer>({
    queryKey: ['customer', tenantSlug, selectedNodeId],
    queryFn: () =>
      api.get(`/${tenantSlug}/customers/${selectedNodeId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!selectedNodeId && selectedNodeId !== customerId,
  });

  const displayCustomer = selectedNodeId === customerId ? customer : selectedCustomer;

  if (customerLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-border-default">
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        고객을 찾을 수 없습니다.
      </div>
    );
  }

  const treeRoots: CustomerTreeNode[] = tree ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <button
          onClick={() => router.push(`/${tenantSlug}/customers`)}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={15} />
          고객
        </button>
        <ChevronRight size={13} className="text-text-disabled" />
        <h1 className="text-lg font-semibold text-text-primary">{customer.name}</h1>
        {customer.contract_grade && (
          <span className="ml-1 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-secondary border border-border-subtle">
            {customer.contract_grade}
          </span>
        )}
      </div>

      {/* KPI 스트립 */}
      {rollup && <KpiStrip rollup={rollup} />}

      {/* 본문: 좌측 트리 + 우측 탭 */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* 부서 트리 */}
        <aside className="w-52 shrink-0 border-r border-border-subtle bg-surface overflow-y-auto flex flex-col">
          <div className="px-3 py-2.5 text-xs font-medium text-text-secondary border-b border-border-subtle">
            조직 구조
          </div>
          {treeLoading ? (
            <div className="p-3 flex flex-col gap-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : (
            <ul className="p-2 flex flex-col gap-0.5">
              {treeRoots.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  selectedId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                  onAddChild={(parentId, parentName) => { setAddDivision({ parentId, parentName }); setNewDivisionName(''); }}
                  depth={0}
                />
              ))}
            </ul>
          )}

          {/* 하위 부서 추가 인라인 폼 */}
          {addDivision && (
            <div className="px-3 py-3 border-t border-border-subtle bg-surface-raised flex flex-col gap-2">
              <p className="text-xs text-text-secondary truncate">
                <span className="font-medium text-text-primary">{addDivision.parentName}</span> 하위 부서
              </p>
              <input
                autoFocus
                type="text"
                value={newDivisionName}
                onChange={(e) => setNewDivisionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newDivisionName.trim()) {
                    addDivisionMutation.mutate({ parentId: addDivision.parentId, name: newDivisionName.trim() });
                  }
                  if (e.key === 'Escape') { setAddDivision(null); setNewDivisionName(''); }
                }}
                placeholder="부서명 입력"
                className="h-7 w-full rounded border border-border-default bg-surface px-2 text-xs text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-border-strong"
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="flex-1 h-7 text-xs"
                  disabled={!newDivisionName.trim()}
                  isLoading={addDivisionMutation.isPending}
                  onClick={() => {
                    if (newDivisionName.trim()) {
                      addDivisionMutation.mutate({ parentId: addDivision.parentId, name: newDivisionName.trim() });
                    }
                  }}
                >
                  추가
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs px-2"
                  onClick={() => { setAddDivision(null); setNewDivisionName(''); }}
                >
                  취소
                </Button>
              </div>
            </div>
          )}
        </aside>

        {/* 우측 탭 영역 */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* 탭 헤더 */}
          <div className="flex border-b border-border-default bg-surface shrink-0 px-4">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors',
                  activeTab === id
                    ? 'border-text-primary text-text-primary font-medium'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {/* 탭 콘텐츠 */}
          <div className="flex-1 overflow-auto min-h-0">
            {activeTab === 'info' && displayCustomer && (
              <InfoTab
                tenantSlug={tenantSlug}
                customerId={selectedNodeId}
                customer={displayCustomer}
                onCustomerUpdated={() => {
                  queryClient.invalidateQueries({ queryKey: ['customer', tenantSlug, selectedNodeId] });
                  queryClient.invalidateQueries({ queryKey: ['customer', tenantSlug, customerId] });
                }}
              />
            )}
            {activeTab === 'tickets' && (
              <TicketsTab tenantSlug={tenantSlug} customerId={selectedNodeId} />
            )}
            {activeTab === 'infra' && (
              <InfraTab tenantSlug={tenantSlug} customerId={selectedNodeId} />
            )}
            {activeTab === 'contracts' && (
              <ContractsTab tenantSlug={tenantSlug} customerId={selectedNodeId} />
            )}
            {activeTab === 'notes' && (
              <NotesTab tenantSlug={tenantSlug} customerId={selectedNodeId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
