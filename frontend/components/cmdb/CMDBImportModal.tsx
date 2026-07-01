'use client';

import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, ClipboardList, Clock, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import type { ImportRun, ImportRunsResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

// -----------------------------------------------------------------------
// 유틸
// -----------------------------------------------------------------------
function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const TARGET_LABELS: Record<string, string> = { ci: 'CI (구성 항목)', asset: '자산' };
const SOURCE_LABELS: Record<string, string> = { csv: 'CSV', json_api: 'JSON' };

const STATUS_STYLES: Record<string, string> = {
  success: 'text-success-text bg-success-bg',
  partial: 'text-warning-text bg-warning-bg',
  failed:  'text-error-text bg-error-bg',
};
const STATUS_LABELS: Record<string, string> = { success: '성공', partial: '부분 성공', failed: '실패' };

// -----------------------------------------------------------------------
// 탭 버튼
// -----------------------------------------------------------------------
type Tab = 'csv' | 'json' | 'history';

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------
// 결과 요약 패널
// -----------------------------------------------------------------------
function ImportResultPanel({ run }: { run: ImportRun }) {
  return (
    <div className="mt-4 rounded-lg border border-border-default bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        {run.status === 'success' ? (
          <CheckCircle2 size={16} className="text-success-text" />
        ) : (
          <AlertCircle size={16} className="text-warning-text" />
        )}
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_STYLES[run.status] ?? 'text-text-secondary bg-surface')}>
          {STATUS_LABELS[run.status] ?? run.status}
        </span>
        <span className="text-xs text-text-secondary">
          {TARGET_LABELS[run.target] ?? run.target} · 총 {run.total_rows}행
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          { label: '생성', value: run.created_count, color: 'text-success-text' },
          { label: '수정', value: run.updated_count, color: 'text-info-text' },
          { label: '건너뜀', value: run.skipped_count, color: 'text-text-secondary' },
          { label: '오류', value: run.error_count, color: 'text-error-text' },
        ].map((item) => (
          <div key={item.label} className="rounded-md border border-border-subtle p-2">
            <p className={cn('text-lg font-bold', item.color)}>{item.value}</p>
            <p className="text-[10px] text-text-secondary">{item.label}</p>
          </div>
        ))}
      </div>
      {run.errors.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-error-text">오류 목록</p>
          <div className="max-h-36 overflow-auto rounded border border-border-subtle bg-surface p-2 space-y-1">
            {run.errors.slice(0, 50).map((e, i) => (
              <p key={i} className="text-xs text-text-secondary font-mono">
                {e.row != null ? `[행 ${e.row}] ` : ''}{typeof e.message === 'string' ? e.message : JSON.stringify(e)}
              </p>
            ))}
            {run.errors.length > 50 && (
              <p className="text-xs text-text-disabled">... 외 {run.errors.length - 50}건</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// CSV 탭
// -----------------------------------------------------------------------
function CsvTab({ tenantSlug, onImported }: { tenantSlug: string; onImported: (run: ImportRun) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<string>('ci');
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  async function handleUpload() {
    if (!file) { toast.error('파일을 선택해주세요.'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<ImportRun>(
        `/${tenantSlug}/cmdb/import/csv?target=${target}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      queryClient.invalidateQueries({ queryKey: ['cmdb-import-runs', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['cmdb-cis', tenantSlug] });
      onImported(data);
      toast.success('Import 완료');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary">대상</label>
        <div className="w-48">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ci">CI (구성 항목)</SelectItem>
              <SelectItem value="asset">자산</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary">CSV 파일 (UTF-8 또는 CP949, 최대 5,000행)</label>
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-default p-8 cursor-pointer hover:border-brand transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={24} className="text-text-disabled" />
          {file ? (
            <p className="text-sm text-text-primary font-medium">{file.name}</p>
          ) : (
            <p className="text-sm text-text-secondary">클릭하여 파일 선택</p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleUpload}
          isLoading={uploading}
          disabled={!file || uploading}
          leftIcon={<Upload size={14} />}
        >
          가져오기 실행
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// JSON 탭
// -----------------------------------------------------------------------
function JsonTab({ tenantSlug, onImported }: { tenantSlug: string; onImported: (run: ImportRun) => void }) {
  const [target, setTarget] = useState<string>('ci');
  const [jsonText, setJsonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  async function handleSubmit() {
    let items: unknown[];
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) { toast.error('JSON은 배열이어야 합니다. 예: [{"name":"서버1",...}]'); return; }
      items = parsed;
    } catch {
      toast.error('JSON 파싱 오류: 유효한 JSON 배열을 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post<ImportRun>(`/${tenantSlug}/cmdb/import/json`, { target, items });
      queryClient.invalidateQueries({ queryKey: ['cmdb-import-runs', tenantSlug] });
      queryClient.invalidateQueries({ queryKey: ['cmdb-cis', tenantSlug] });
      onImported(data);
      toast.success('Import 완료');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary">대상</label>
        <div className="w-48">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ci">CI (구성 항목)</SelectItem>
              <SelectItem value="asset">자산</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary">
          JSON 배열 붙여넣기 (최대 5,000항목)
        </label>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder={'[\n  {"name": "서버1", "ci_type": "server", "status": "active", ...}\n]'}
          rows={10}
          className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-border-strong resize-y"
        />
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSubmit}
          isLoading={submitting}
          disabled={!jsonText.trim() || submitting}
          leftIcon={<ClipboardList size={14} />}
        >
          가져오기 실행
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// 이력 탭
// -----------------------------------------------------------------------
function HistoryTab({ tenantSlug }: { tenantSlug: string }) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const { data, isLoading, refetch } = useQuery<ImportRunsResponse>({
    queryKey: ['cmdb-import-runs', tenantSlug, page],
    queryFn: () =>
      api
        .get(`/${tenantSlug}/cmdb/import/runs`, { params: { page, page_size: PAGE_SIZE } })
        .then((r) => r.data),
    enabled: !!tenantSlug,
  });

  const runs: ImportRun[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="pt-2 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">최근 import 실행 이력 (최신순)</p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Clock size={24} className="text-text-disabled" />
          <p className="text-sm text-text-secondary">import 이력이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-border-subtle bg-surface p-3 flex items-start gap-3">
              <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', STATUS_STYLES[r.status] ?? 'text-text-secondary bg-surface')}>
                {STATUS_LABELS[r.status] ?? r.status}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-text-primary">
                    {TARGET_LABELS[r.target] ?? r.target} · {SOURCE_LABELS[r.source] ?? r.source}
                  </span>
                  <span className="text-xs text-text-secondary">
                    생성 {r.created_count} / 수정 {r.updated_count} / 스킵 {r.skipped_count} / 오류 {r.error_count}
                  </span>
                </div>
                <p className="text-[10px] text-text-disabled mt-0.5">{formatDate(r.created_at)}</p>
              </div>
              <span className="text-xs text-text-disabled shrink-0">{r.total_rows}행</span>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
          <span className="text-xs text-text-secondary">{page} / {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</Button>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// 메인 모달
// -----------------------------------------------------------------------
interface CMDBImportModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
}

export function CMDBImportModal({ open, onClose, tenantSlug }: CMDBImportModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('csv');
  const [lastResult, setLastResult] = useState<ImportRun | null>(null);

  function handleImported(run: ImportRun) {
    setLastResult(run);
    // 이력 탭은 자동 갱신되므로 탭 전환 없이 결과 표시
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>CMDB Discovery Import</DialogTitle>
        </DialogHeader>

        {/* 탭 헤더 */}
        <div className="flex border-b border-border-subtle shrink-0 -mx-6 px-6">
          <TabButton label="CSV 업로드" active={activeTab === 'csv'} onClick={() => { setActiveTab('csv'); setLastResult(null); }} />
          <TabButton label="JSON 붙여넣기" active={activeTab === 'json'} onClick={() => { setActiveTab('json'); setLastResult(null); }} />
          <TabButton label="이력" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
        </div>

        {/* 탭 콘텐츠 */}
        <div className="flex-1 overflow-auto min-h-0 py-2">
          {activeTab === 'csv' && (
            <>
              <CsvTab tenantSlug={tenantSlug} onImported={handleImported} />
              {lastResult && <ImportResultPanel run={lastResult} />}
            </>
          )}
          {activeTab === 'json' && (
            <>
              <JsonTab tenantSlug={tenantSlug} onImported={handleImported} />
              {lastResult && <ImportResultPanel run={lastResult} />}
            </>
          )}
          {activeTab === 'history' && <HistoryTab tenantSlug={tenantSlug} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
