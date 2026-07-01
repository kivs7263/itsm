'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, BookOpen, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CreateKbModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  /** 수정 모드: 기존 문서 ID — 있으면 PATCH, 없으면 POST */
  editId?: string;
  /** 티켓에서 "KB로 저장" 시 또는 수정 시 prefill */
  prefill?: {
    title?: string;
    content?: string;
    linkedTicketId?: string;
  };
}

interface KbCreatePayload {
  title: string;
  content: string;
  tags: string[];
  linked_ticket_id: string | null;
  is_published: boolean;
}

export function CreateKbModal({ open, onClose, tenantSlug, editId, prefill }: CreateKbModalProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isPublished, setIsPublished] = useState(true);
  const [aiGenerating, setAiGenerating] = useState(false);

  // prefill 적용 (모달 열릴 때마다)
  useEffect(() => {
    if (open) {
      setTitle(prefill?.title ?? '');
      setContent(prefill?.content ?? '');
      setTagsInput('');
      setIsPublished(true);
    }
  }, [open, prefill]);

  const mutation = useMutation({
    mutationFn: (payload: KbCreatePayload) =>
      api.post(`/${tenantSlug}/kb`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('KB 문서가 등록되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['kb-list', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['kb-keyword', tenantSlug] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 수정 모드: editId 있으면 PATCH /{tenantSlug}/kb/{editId}
  const updateMutation = useMutation({
    mutationFn: (payload: KbCreatePayload) =>
      api.patch(`/${tenantSlug}/kb/${editId}`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('KB 문서가 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['kb-list', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['kb-keyword', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['kb-article', tenantSlug, editId] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (!open) return null;

  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  async function handleAiDraft() {
    if (!prefill?.linkedTicketId) {
      toast.error('연결된 티켓이 없어 AI 초안을 생성할 수 없습니다.');
      return;
    }
    setAiGenerating(true);
    try {
      const res = await api.post(`/${tenantSlug}/kb/generate-draft`, {
        ticket_id: prefill.linkedTicketId,
      });
      if (res.data?.title) {
        setTitle(res.data.title);
        setContent(res.data.content ?? '');
        setTagsInput((res.data.tags ?? []).join(', '));
        toast.success('AI 초안이 생성되었습니다.');
      } else {
        toast.error('AI 초안 생성에 실패했습니다. ANTHROPIC_API_KEY 설정을 확인하세요.');
      }
    } catch {
      toast.error('AI 초안 생성 중 오류가 발생했습니다.');
    } finally {
      setAiGenerating(false);
    }
  }

  const isSubmitting = editId ? updateMutation.isPending : mutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      toast.error('내용을 입력해주세요.');
      return;
    }
    const payload: KbCreatePayload = {
      title: title.trim(),
      content: content.trim(),
      tags,
      linked_ticket_id: prefill?.linkedTicketId ?? null,
      is_published: isPublished,
    };
    if (editId) {
      updateMutation.mutate(payload);
    } else {
      mutation.mutate(payload);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 백드롭 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 모달 */}
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-surface rounded-xl shadow-xl border border-border-default flex flex-col max-h-[90vh]">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-brand" />
            <h2 className="text-base font-semibold text-text-primary">
              {editId ? 'KB 문서 수정' : '새 KB 문서'}
            </h2>
          </div>
          {prefill?.linkedTicketId && (
            <button
              type="button"
              onClick={handleAiDraft}
              disabled={aiGenerating}
              className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
            >
              <Sparkles size={12} className={aiGenerating ? 'animate-pulse' : ''} />
              {aiGenerating ? 'AI 초안 생성 중…' : 'AI 초안 생성'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5 overflow-y-auto">
          {/* 제목 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">
              제목 <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="문서 제목 입력"
              maxLength={500}
              className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          {/* 내용 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">
              내용 <span className="text-error">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="문제 상황, 원인, 해결 방법을 상세히 작성해주세요."
              rows={10}
              className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y min-h-[180px]"
            />
            <p className="text-xs text-text-secondary">{content.length}자 (100자 이상 권장)</p>
          </div>

          {/* 태그 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">태그</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="태그1, 태그2, 태그3 (쉼표로 구분)"
              className="h-9 w-full rounded-md border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-border-subtle px-2 py-0.5 text-xs text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 게시 여부 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={isPublished}
              onClick={() => setIsPublished((v) => !v)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                isPublished ? 'bg-brand' : 'bg-border-default',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                  isPublished ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
            <span className="text-sm text-text-primary">
              {isPublished ? '즉시 게시' : '초안으로 저장'}
            </span>
          </div>

          {prefill?.linkedTicketId && (
            <p className="text-xs text-text-secondary">
              연결 티켓이 자동으로 설정됩니다.
            </p>
          )}
        </form>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-default shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit as unknown as () => void}
            disabled={isSubmitting || !title.trim() || !content.trim()}
          >
            {isSubmitting ? '저장 중...' : editId ? '수정' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  );
}
