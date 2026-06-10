import * as React from 'react';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// Skeleton — shimmer 애니메이션 로딩 플레이스홀더
// globals.css의 .skeleton 클래스(shimmer 애니메이션) 활용
// -----------------------------------------------------------------------
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('skeleton rounded-md', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
