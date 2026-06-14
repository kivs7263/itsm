'use client';

import React, { useState } from 'react';
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
  BarChart3,
  Package,
  ScrollText,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type {
  Customer,
  CustomerTreeNode,
  CustomerRollup,
  CustomerNote,
  Ticket,
  Asset,
  Contract,
} from '@/lib/types';
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
  depth,
}: {
  node: CustomerTreeNode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <button
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
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
      {hasChildren && open && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------
// 탭: Overview
// -----------------------------------------------------------------------
function OverviewTab({ customer }: { customer: Customer }) {
  const fields: { label: string; value: string | null }[] = [
    { label: '이름', value: customer.name },
    { label: '종류', value: customer.kind === 'account' ? '최상위 고객사' : '하위 부서' },
    { label: '이메일', value: customer.email },
    { label: '전화', value: customer.phone },
    { label: '계약 등급', value: customer.contract_grade },
    { label: '생성일', value: formatRelativeTime(customer.created_at) },
  ];

  return (
    <div className="p-6 max-w-lg">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        {fields.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs text-text-secondary">{label}</dt>
            <dd className="mt-0.5 text-sm text-text-primary">{value ?? '-'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭: 티켓
// -----------------------------------------------------------------------
function TicketsTab({ tenantSlug, customerId }: { tenantSlug: string; customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-tickets', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/tickets`, { params: { customer_id: customerId, page_size: 50 } })
        .then((r) => r.data),
  });

  const tickets: Ticket[] = data?.items ?? [];

  if (isLoading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-secondary text-sm">
        연결된 티켓이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface border-b border-border-default">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">번호</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">제목</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">생성일</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className="border-b border-border-subtle">
              <td className="px-4 py-2.5 text-text-secondary font-mono text-xs">{t.id.slice(0, 8)}</td>
              <td className="px-4 py-2.5 text-text-primary">{t.title}</td>
              <td className="px-4 py-2.5 text-text-secondary capitalize">{t.status}</td>
              <td className="px-4 py-2.5 text-text-secondary text-xs">{formatRelativeTime(t.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭: 자산
// -----------------------------------------------------------------------
function AssetsTab({ tenantSlug, customerId }: { tenantSlug: string; customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-assets', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/assets`, { params: { customer_id: customerId, page_size: 50 } })
        .then((r) => r.data),
  });

  const assets: Asset[] = data?.items ?? [];

  if (isLoading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-secondary text-sm">
        등록된 자산이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface border-b border-border-default">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">자산 태그</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">모델</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">유형</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">보증 만료</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} className="border-b border-border-subtle">
              <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{a.asset_tag ?? '-'}</td>
              <td className="px-4 py-2.5 text-text-primary">{a.model ?? '-'}</td>
              <td className="px-4 py-2.5 text-text-secondary">{a.asset_type ?? '-'}</td>
              <td className="px-4 py-2.5 text-text-secondary text-xs">
                {a.warranty_expires_at ? formatRelativeTime(a.warranty_expires_at) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -----------------------------------------------------------------------
// 탭: 계약
// -----------------------------------------------------------------------
function ContractsTab({ tenantSlug, customerId }: { tenantSlug: string; customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-contracts', tenantSlug, customerId],
    queryFn: () =>
      api.get(`/${tenantSlug}/contracts`, { params: { customer_id: customerId, page_size: 50 } })
        .then((r) => r.data),
  });

  const contracts: Contract[] = data?.items ?? [];

  if (isLoading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;

  if (contracts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-secondary text-sm">
        연결된 계약이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface border-b border-border-default">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">계약명</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">상태</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary">만료일</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.id} className="border-b border-border-subtle">
              <td className="px-4 py-2.5 text-text-primary">{c.name}</td>
              <td className="px-4 py-2.5 text-text-secondary capitalize">{c.contract_type ?? '-'}</td>
              <td className="px-4 py-2.5 text-text-secondary text-xs">
                {c.end_date ? formatRelativeTime(c.end_date) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <div className="rounded-lg border border-border-default bg-surface p-4 flex flex-col gap-3">
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
        <div key={note.id} className="rounded-lg border border-border-default bg-surface p-4">
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
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'tickets',  label: '티켓',    icon: ScrollText },
  { id: 'assets',   label: '자산',    icon: Package },
  { id: 'contracts',label: '계약',    icon: FileText },
  { id: 'notes',    label: '메모',    icon: Clock },
] as const;

type TabId = typeof TABS[number]['id'];

// -----------------------------------------------------------------------
// 고객 360도 상세 페이지
// -----------------------------------------------------------------------
export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug as string;
  const customerId = params?.customerId as string;

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(customerId);

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
                  depth={0}
                />
              ))}
            </ul>
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
            {activeTab === 'overview' && displayCustomer && (
              <OverviewTab customer={displayCustomer} />
            )}
            {activeTab === 'tickets' && (
              <TicketsTab tenantSlug={tenantSlug} customerId={selectedNodeId} />
            )}
            {activeTab === 'assets' && (
              <AssetsTab tenantSlug={tenantSlug} customerId={selectedNodeId} />
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
