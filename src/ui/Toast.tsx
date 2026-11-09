import { useEffect, useState } from 'react';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastProps {
  message: string | null;
  tone?: ToastTone;
  onDone?: () => void;
}

const TONES: Record<ToastTone, string> = {
  info: 'border-border text-text',
  success: 'border-success text-success',
  danger: 'border-danger text-danger',
};

export function Toast({ message, tone = 'info', onDone }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, 2_500);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message || !visible) return null;
  return (
    <div
      className={`fixed bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-oa border bg-surface px-3 py-1.5 text-[12px] shadow ${TONES[tone]}`}
      role="status"
    >
      {message}
    </div>
  );
}
