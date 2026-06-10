import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Primary gradient 스타일
const PRIMARY_GRADIENT_STYLE: React.CSSProperties = {
  background: 'linear-gradient(135deg, var(--color-brand-hover) 0%, var(--color-brand) 50%, var(--color-brand-active) 100%)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.15)',
  transition: 'box-shadow 150ms ease-out, transform 100ms ease-out, filter 150ms ease-out',
};

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5',
    'rounded-md font-semibold',
    'transition-colors duration-fast ease-smooth',
    'focus-visible:outline-none focus-visible:shadow-brand',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    'select-none',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'text-[#1A1A1A]',
          'hover:brightness-[1.08]',
          'active:brightness-[0.96] active:scale-[0.98]',
        ].join(' '),
        outline: [
          'bg-transparent text-text-primary border border-border-default',
          'hover:bg-surface-hover',
          'active:scale-[0.98]',
        ].join(' '),
        ghost: [
          'bg-transparent text-text-secondary',
          'hover:bg-surface-hover hover:text-text-primary',
          'active:scale-[0.98]',
        ].join(' '),
        destructive: [
          'bg-error text-white',
          'hover:bg-error-text',
          'active:scale-[0.98]',
        ].join(' '),
        secondary: [
          'bg-surface text-text-primary border border-border-strong',
          'hover:bg-surface-hover',
          'active:scale-[0.98]',
        ].join(' '),
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3.5 text-sm',
        lg: 'h-10 px-[18px] text-base',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      style: styleProp,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isPrimary = (variant ?? 'default') === 'default';
    const mergedStyle = isPrimary
      ? { ...PRIMARY_GRADIENT_STYLE, ...styleProp }
      : styleProp;

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || isLoading}
        style={mergedStyle}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="animate-spin" size={size === 'sm' || size === 'icon-sm' ? 12 : 14} />
            {children}
          </>
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
