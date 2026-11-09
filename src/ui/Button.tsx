import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'subtle' | 'danger';

const BASE =
  'inline-flex items-center justify-center gap-1 rounded-oa px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90',
  subtle: 'border border-border bg-surface text-text hover:bg-bg',
  danger: 'border border-danger text-danger hover:bg-danger/10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'subtle', className = '', children, ...rest }: ButtonProps) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
