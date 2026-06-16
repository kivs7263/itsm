'use client';

export default function CustomerError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary">
      <p className="text-sm">고객 정보를 불러오지 못했습니다.</p>
      <button
        onClick={reset}
        className="px-4 py-1.5 text-sm rounded-md border border-border-default hover:bg-surface-hover transition-colors"
      >
        다시 시도
      </button>
    </div>
  );
}
