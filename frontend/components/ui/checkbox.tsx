'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// Checkbox — 네이티브 input[type=checkbox] 기반 구현
// @radix-ui/react-checkbox 미설치로 네이티브 구현
// -----------------------------------------------------------------------
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  indeterminate?: boolean;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, indeterminate, id, ...props }, ref) => {
    const internalRef = React.useRef<HTMLInputElement>(null);
    const resolvedRef = (ref as React.RefObject<HTMLInputElement>) || internalRef;

    React.useEffect(() => {
      if (resolvedRef && 'current' in resolvedRef && resolvedRef.current) {
        resolvedRef.current.indeterminate = indeterminate ?? false;
      }
    }, [indeterminate, resolvedRef]);

    const inputEl = (
      <div className="relative flex items-center justify-center">
        <input
          type="checkbox"
          ref={resolvedRef}
          id={id}
          className={cn(
            'peer h-4 w-4 shrink-0 rounded-sm border border-border-strong',
            'bg-surface appearance-none cursor-pointer',
            'checked:bg-accent checked:border-accent',
            'indeterminate:bg-accent indeterminate:border-accent',
            'focus-visible:outline-none focus-visible:shadow-brand',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors duration-fast',
            className,
          )}
          {...props}
        />
        <Check
          size={10}
          className="absolute pointer-events-none text-accent-on opacity-0 peer-checked:opacity-100 transition-opacity"
          strokeWidth={3}
        />
      </div>
    );

    if (label) {
      return (
        <label htmlFor={id} className="flex items-center gap-2 cursor-pointer">
          {inputEl}
          <span className="text-sm text-text-primary">{label}</span>
        </label>
      );
    }

    return inputEl;
  },
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
