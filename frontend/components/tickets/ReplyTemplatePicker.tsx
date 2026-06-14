'use client';

import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { BookOpen, Search } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ReplyTemplate, ReplyTemplatesResponse } from '@/lib/types';

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

interface ReplyTemplatePickerProps {
  tenantSlug: string;
  onSelect: (body: string) => void;
}

// -----------------------------------------------------------------------
// ReplyTemplatePicker
// -----------------------------------------------------------------------

export function ReplyTemplatePicker({ tenantSlug, onSelect }: ReplyTemplatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const { data, isLoading } = useQuery<ReplyTemplatesResponse>({
    queryKey: ['reply-templates', tenantSlug],
    queryFn: () =>
      api.get(`/${tenantSlug}/reply-templates`).then((r) => r.data),
    staleTime: 2 * 60 * 1000,
    enabled: open,
  });

  const useMut = useMutation({
    mutationFn: (id: string) =>
      api.post(`/${tenantSlug}/reply-templates/${id}/use`),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const templates: ReplyTemplate[] = data?.items ?? [];

  const filtered = search.trim()
    ? templates.filter((t) =>
        t.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : templates;

  function handleSelect(template: ReplyTemplate) {
    useMut.mutate(template.id);
    onSelect(template.body);
    setOpen(false);
    setSearch('');
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
            'border border-border-default bg-surface text-text-secondary',
            'hover:bg-surface-hover hover:text-text-primary transition-colors',
            open && 'bg-surface-hover text-text-primary',
          )}
          aria-label="답변 템플릿 선택"
        >
          <BookOpen size={12} />
          템플릿
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          className={cn(
            'z-[200] w-72 rounded-lg border border-border-default bg-surface shadow-lg',
            'animate-in fade-in-0 zoom-in-95',
          )}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* 검색 */}
          <div className="flex items-center gap-2 border-b border-border-default px-3 py-2">
            <Search size={13} className="text-text-secondary shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="템플릿 검색..."
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-disabled outline-none"
            />
          </div>

          {/* 목록 */}
          <div
            className="overflow-y-auto"
            style={{ maxHeight: 300 }}
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-text-secondary">
                불러오는 중...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-sm text-text-secondary">
                {search.trim() ? '검색 결과가 없습니다.' : '등록된 템플릿이 없습니다.'}
              </div>
            ) : (
              filtered.map((template) => (
                <DropdownMenu.Item
                  key={template.id}
                  onSelect={() => handleSelect(template)}
                  className={cn(
                    'flex flex-col gap-0.5 px-3 py-2.5 cursor-pointer outline-none',
                    'hover:bg-surface-hover focus:bg-surface-hover transition-colors',
                    'border-b border-border-subtle last:border-b-0',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary truncate flex-1">
                      {template.name}
                    </span>
                    {template.category && (
                      <span className="shrink-0 inline-flex items-center rounded-full bg-surface-elevated border border-border-default px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                        {template.category}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary line-clamp-1">
                    {template.body}
                  </p>
                </DropdownMenu.Item>
              ))
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
