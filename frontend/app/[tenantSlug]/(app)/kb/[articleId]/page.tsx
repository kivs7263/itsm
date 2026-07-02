'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, ThumbsUp, ThumbsDown, Pencil, Trash2, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { KbArticle } from '@/lib/types';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { CreateKbModal } from '@/components/kb/CreateKbModal';

interface KbArticleDetail extends KbArticle {
  author_name: string | null;
  view_count: number;
  helpful_votes: number;
  not_helpful_votes: number;
}

function canWrite(role: string | undefined): boolean {
  return ['engineer', 'team_lead', 'admin'].includes(role ?? '');
}

function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-3/4" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}

export default function KbArticlePage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const articleId = params?.articleId as string;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [voted, setVoted] = useState<'helpful' | 'not_helpful' | null>(null);

  const { data: article, isLoading, isError, refetch } = useQuery<KbArticleDetail>({
    queryKey: ['kb-article', tenantSlug, articleId],
    queryFn: () =>
      api.get(`/${tenantSlug}/kb/${articleId}`).then((r) => r.data),
    enabled: !!tenantSlug && !!articleId,
    staleTime: 60_000,
  });

  const voteMutation = useMutation({
    mutationFn: (vote: 'helpful' | 'not_helpful') =>
      api.post(`/${tenantSlug}/kb/${articleId}/vote`, { vote }).then((r) => r.data),
    onSuccess: (data, vote) => {
      setVoted(vote);
      queryClient.setQueryData(['kb-article', tenantSlug, articleId], (old: KbArticleDetail | undefined) =>
        old ? { ...old, ...data } : old
      );
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await api.delete(`/${tenantSlug}/kb/${articleId}`);
      toast.success('KB 문서가 삭제되었습니다.');
      await queryClient.invalidateQueries({ queryKey: ['kb-list', tenantSlug] });
      await queryClient.invalidateQueries({ queryKey: ['kb-keyword', tenantSlug] });
      router.push(`/${tenantSlug}/kb`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertCircle size={32} className="text-error" />
        <p className="text-sm text-text-secondary">문서를 불러오지 못했습니다.</p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-medium"
        >
          <RefreshCw size={12} />
          다시 시도
        </button>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-secondary">
        <p className="text-sm">KB 문서를 찾을 수 없습니다.</p>
        <Link href={`/${tenantSlug}/kb`} className="text-sm text-brand hover:underline">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const isAuthor = user?.id === article.author_id;
  const isAdmin = user?.role === 'admin';
  const canEdit = canWrite(user?.role) && (isAuthor || isAdmin);

  return (
    <div className="min-h-full bg-bg">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* 뒤로가기 */}
        <div className="mb-6">
          <Link
            href={`/${tenantSlug}/kb`}
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={14} />
            지식베이스
          </Link>
        </div>

        {/* 헤더 */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h1 className="text-xl font-bold text-text-primary leading-snug flex-1">
              {article.title}
            </h1>
            {canEdit && (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Pencil size={12} />}
                  onClick={() => setEditOpen(true)}
                >
                  수정
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Trash2 size={12} />}
                  onClick={() => setDeleteOpen(true)}
                  className="text-error-text border-error hover:bg-error-bg"
                >
                  삭제
                </Button>
              </div>
            )}
          </div>

          {/* 메타 */}
          <div className="flex items-center gap-3 text-xs text-text-secondary flex-wrap">
            {article.author_name && (
              <span>{article.author_name}</span>
            )}
            <span>·</span>
            <span>{formatRelativeTime(article.created_at)}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Eye size={11} />
              {article.view_count ?? 0}
            </span>
            {!article.is_published && (
              <>
                <span>·</span>
                <span className="inline-flex items-center rounded-full bg-border-subtle px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                  초안
                </span>
              </>
            )}
          </div>

          {/* 태그 */}
          {article.tags && article.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {article.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-border-subtle px-2.5 py-0.5 text-xs text-text-secondary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 구분선 */}
        <div className="h-px bg-border-default mb-6" />

        {/* 본문 */}
        <div className="prose prose-sm max-w-none">
          <pre
            className={cn(
              'whitespace-pre-wrap font-sans text-sm text-text-primary leading-relaxed',
            )}
          >
            {article.content}
          </pre>
        </div>

        {/* 유용한가요? 투표 */}
        <div className="mt-10 pt-6 border-t border-border-subtle">
          <p className="text-sm font-medium text-text-primary mb-3">이 문서가 유용했나요?</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!!voted || voteMutation.isPending}
              onClick={() => voteMutation.mutate('helpful')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                voted === 'helpful'
                  ? 'border-success bg-success-bg text-success-text'
                  : 'border-border-default bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-hover',
                (!!voted || voteMutation.isPending) && 'cursor-not-allowed opacity-60',
              )}
            >
              <ThumbsUp size={14} />
              <span>도움됨</span>
              {(article.helpful_votes ?? 0) > 0 && (
                <span className="font-medium">{article.helpful_votes}</span>
              )}
            </button>

            <button
              type="button"
              disabled={!!voted || voteMutation.isPending}
              onClick={() => voteMutation.mutate('not_helpful')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                voted === 'not_helpful'
                  ? 'border-error bg-error-bg text-error-text'
                  : 'border-border-default bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-hover',
                (!!voted || voteMutation.isPending) && 'cursor-not-allowed opacity-60',
              )}
            >
              <ThumbsDown size={14} />
              <span>도움 안됨</span>
              {(article.not_helpful_votes ?? 0) > 0 && (
                <span className="font-medium">{article.not_helpful_votes}</span>
              )}
            </button>
          </div>
          {voted && (
            <p className="mt-2 text-xs text-text-secondary">
              피드백 감사합니다.
            </p>
          )}
        </div>
      </div>

      {/* 수정 모달 */}
      {editOpen && (
        <CreateKbModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          tenantSlug={tenantSlug}
          editId={articleId}
          prefill={{
            title: article.title,
            content: article.content,
            linkedTicketId: article.linked_ticket_id ?? undefined,
          }}
        />
      )}

      {/* KB 삭제 확인 다이얼로그 */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => { if (!isDeleting) setDeleteOpen(false); }}
            aria-hidden="true"
          />
          <div className="relative z-10 bg-surface rounded-xl shadow-xl border border-border-default p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error-bg shrink-0">
                <Trash2 size={18} className="text-error-text" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary">KB 문서 삭제</h3>
                <p className="text-xs text-text-secondary mt-0.5">이 작업은 되돌릴 수 없습니다.</p>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-6">
              <span className="font-medium text-text-primary">{article.title}</span>을(를) 정말 삭제하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteOpen(false)}
                disabled={isDeleting}
              >
                취소
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                isLoading={isDeleting}
                className="bg-error text-white hover:bg-error/90"
              >
                삭제
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
