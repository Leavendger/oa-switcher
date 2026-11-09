import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-text">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}

export const inputClass =
  'w-full rounded-oa border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-accent';
