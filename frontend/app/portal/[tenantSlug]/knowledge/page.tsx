'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search, ChevronRight, ArrowLeft } from 'lucide-react';
import api from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';

interface PortalKbArticle {
  id: string;
  title: string;
  content: string;
  tags: string[];
  view_count: number;
  created_at: string;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border-default bg-surface p-4 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export default function PortalKnowledgePage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const [q, setQ] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<PortalKbArticle | null>(null);

  const { data: articles, isLoading } = useQuery<PortalKbArticle[]>({
    queryKey: ['portal-kb-search', tenantSlug, q],
    queryFn: async () => {
      const res = await api.get<PortalKbArticle[]>(
        `/portal/${tenantSlug}/kb/search`,
        q.trim() ? { params: { q: q.trim() } } : undefined,
      );
      const d = res.data;
      return Array.isArray(d) ? d : Array.isArray((d as { items?: PortalKbArticle[] }).items) ? (d as { items: PortalKbArticle[] }).items : [];
    },
    enabled: !!tenantSlug,
    staleTime: 60_000,
  });

  // 문서 상세 보기
  if (selectedArticle) {
    return (
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={() => setSelectedArticle(null)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors w-fit"
        >
          <ArrowLeft size={14} />
          목록으로
        </button>

        <div>
          <h1 className="text-xl font-bold text-text-primary">{selectedArticle.title}</h1>
          {selectedArticle.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {selectedArticle.tags.map((tag) => (
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

        <div className="h-px bg-border-default" />

        <pre className="whitespace-pre-wrap font-sans text-sm text-text-primary leading-relaxed">
          {selectedArticle.content}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">자주 묻는 질문</h1>
        <p className="mt-1 text-sm text-text-secondary">
          문제 해결 방법을 검색해보세요.
        </p>
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none"
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="검색어 입력..."
          className="h-11 w-full pl-9 pr-4 rounded-xl border border-border-default bg-surface text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      {/* 결과 */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : !articles || articles.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(245, 192, 0, 0.12)' }}
          >
            <BookOpen size={28} strokeWidth={1.5} style={{ color: '#F5C000' }} />
          </div>
          <p className="text-sm text-text-secondary">
            {q ? `"${q}"에 대한 검색 결과가 없습니다.` : '등록된 FAQ가 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <button
              key={article.id}
              type="button"
              onClick={() => setSelectedArticle(article)}
              className="rounded-xl border border-border-default bg-surface p-4 text-left hover:border-border-strong hover:shadow-sm transition-all duration-fast w-full flex items-start justify-between gap-3"
            >
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary line-clamp-1">
                  {article.title}
                </p>
                <p className="text-xs text-text-secondary line-clamp-2">
                  {article.content}
                </p>
                {article.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {article.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-border-subtle px-2 py-0.5 text-[11px] text-text-secondary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ChevronRight size={16} className="shrink-0 text-text-secondary mt-0.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
