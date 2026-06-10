import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// Badge variants — CVA
// -----------------------------------------------------------------------
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border',
  {
    variants: {
      variant: {
        default:     'bg-neutral-100 text-text-secondary border-transparent',
        outline:     'bg-transparent text-text-secondary border-border-default',
        destructive: 'bg-error-bg text-error-text border-transparent',
        success:     'bg-success-bg text-success-text border-transparent',
        warning:     'bg-warning-bg text-warning-text border-transparent',
        info:        'bg-info-bg text-info-text border-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
