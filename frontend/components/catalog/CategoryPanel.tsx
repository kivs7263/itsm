'use client';

/**
 * components/catalog/CategoryPanel.tsx — 서비스 카탈로그 카테고리 CRUD 패널
 *
 * 엔드포인트 근거: backend/app/routers/service_catalog.py
 *   GET   /{tenant_slug}/service-catalog/categories            L227-250 (include_inactive)
 *   POST  /{tenant_slug}/service-catalog/categories             L253-293
 *   PATCH /{tenant_slug}/service-catalog/categories/{cat_id}    L296-327
 *     (CategoryUpdate에는 slug 없음 — slug는 생성 후 수정 불가, L60-65)
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, FolderOpen, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ServiceCategory,
  CategoryCreatePayload,
  CategoryUpdatePayload,
} from '@/components/catalog/catalogTypes';

function inputCls() {
  return cn(
    'h-9 w-full rounded-md border border-border-default px-2.5 text-sm',
    'bg-surface text-text-primary placeholder:text-text-disabled',
    'focus:outline-none focus:ring-2 focus:ring-accent-500',
  );
}

// -----------------------------------------------------------------------
// 카테고리 생성/수정 다이얼로그
// -----------------------------------------------------------------------
interface CategoryDialogProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  categories: ServiceCategory[];
  editing: ServiceCategory | null;
}

function CategoryDialog({ open, onClose, tenantSlug, categories, editing }: CategoryDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editing;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [icon, setIcon] = useState('');
  const [parentId, setParentId] = useState<string>('__none__');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setSlug(editing.slug);
      setIcon(editing.icon ?? '');
      setParentId(editing.parent_id ?? '__none__');
      setDisplayOrder(editing.display_order);
      setIsActive(editing.is_active);
    } else {
      setName('');
      setSlug('');
      setIcon('');
      setParentId('__none__');
      setDisplayOrder(0);
      setIsActive(true);
    }
  }, [open, editing]);

  const createMutation = useMutation({
    mutationFn: (payload: CategoryCreatePayload) =>
      api.post(`/${tenantSlug}/service-catalog/categories`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('카테고리가 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['catalog-categories', tenantSlug] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: CategoryUpdatePayload) =>
      api
        .patch(`/${tenantSlug}/service-catalog/categories/${editing?.id}`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('카테고리가 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['catalog-categories', tenantSlug] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('이름을 입력해주세요.');
      return;
    }
    const resolvedParent = parentId === '__none__' ? null : parentId;
    if (isEdit) {
      updateMutation.mutate({
        name,
        icon: icon || null,
        parent_id: resolvedParent,
        display_order: displayOrder,
        is_active: isActive,
      });
    } else {
      if (!slug.trim()) {
        toast.error('slug를 입력해주세요.');
        return;
      }
      createMutation.mutate({
        name,
        slug,
        icon: icon || null,
        parent_id: resolvedParent,
        display_order: displayOrder,
      });
    }
  }

  // 자기 자신을 부모로 선택 불가 (백엔드 400도 방어하지만 UX상 목록에서 제외)
  const parentOptions = categories.filter((c) => c.id !== editing?.id);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '카테고리 수정' : '카테고리 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 pb-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">이름 *</label>
            <input
              type="text"
              className={inputCls()}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              autoFocus
            />
          </div>

          {!isEdit && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">
                slug * (생성 후 수정 불가)
              </label>
              <input
                type="text"
                className={inputCls()}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={isPending}
                placeholder="hardware-request"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">아이콘 (선택)</label>
            <input
              type="text"
              className={inputCls()}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              disabled={isPending}
              placeholder="lucide 아이콘명 등"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">상위 카테고리</label>
            <Select
              value={parentId}
              disabled={isPending}
              onValueChange={setParentId}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">없음 (최상위)</SelectItem>
                {parentOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
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
              disabled={isPending}
            />
          </div>

          {isEdit && (
            <Checkbox
              id="cat-active"
              label="활성화"
              checked={isActive}
              disabled={isPending}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          )}

          <DialogFooter className="px-0">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              취소
            </Button>
            <Button type="submit" isLoading={isPending}>
              {isEdit ? '저장' : '추가'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// 카테고리 패널 본체
// -----------------------------------------------------------------------
interface CategoryPanelProps {
  tenantSlug: string;
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
}

export function CategoryPanel({ tenantSlug, selectedCategoryId, onSelectCategory }: CategoryPanelProps) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceCategory | null>(null);

  const { data, isLoading } = useQuery<ServiceCategory[]>({
    queryKey: ['catalog-categories', tenantSlug, includeInactive],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/service-catalog/categories`, {
          params: { include_inactive: includeInactive },
        })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const categories = data ?? [];

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(cat: ServiceCategory, e: React.MouseEvent) {
    e.stopPropagation();
    setEditing(cat);
    setDialogOpen(true);
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-border-default bg-surface">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          카테고리
        </span>
        <Button variant="ghost" size="icon-sm" onClick={openCreate} title="카테고리 추가">
          <Plus size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
            selectedCategoryId === null
              ? 'bg-accent-500/10 text-accent-500 font-medium'
              : 'text-text-secondary hover:bg-surface-hover',
          )}
        >
          <Layers size={14} />
          전체
        </button>

        {isLoading ? (
          <div className="flex flex-col gap-2 px-3 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          categories.map((cat) => (
            <div
              key={cat.id}
              className={cn(
                'group flex w-full items-center justify-between gap-1 px-3 py-2 text-sm transition-colors cursor-pointer',
                selectedCategoryId === cat.id
                  ? 'bg-accent-500/10 text-accent-500 font-medium'
                  : 'text-text-secondary hover:bg-surface-hover',
                !cat.is_active && 'opacity-50',
              )}
              onClick={() => onSelectCategory(cat.id)}
            >
              <span className="flex items-center gap-2 truncate">
                <FolderOpen size={14} className="shrink-0" />
                <span className="truncate">{cat.name}</span>
                {!cat.is_active && (
                  <span className="text-[10px] text-text-disabled shrink-0">(비활성)</span>
                )}
              </span>
              <button
                type="button"
                onClick={(e) => openEdit(cat, e)}
                className="opacity-0 group-hover:opacity-100 shrink-0 text-text-disabled hover:text-text-primary"
                title="카테고리 수정"
              >
                <Pencil size={12} />
              </button>
            </div>
          ))
        )}

        {!isLoading && categories.length === 0 && (
          <p className="px-3 py-4 text-xs text-text-disabled">카테고리가 없습니다.</p>
        )}
      </div>

      <div className="px-3 py-2.5 border-t border-border-subtle">
        <Checkbox
          id="cat-include-inactive"
          label="비활성 카테고리 포함"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
        />
      </div>

      <CategoryDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        tenantSlug={tenantSlug}
        categories={categories}
        editing={editing}
      />
    </div>
  );
}
