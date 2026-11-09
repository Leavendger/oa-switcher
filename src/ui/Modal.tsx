import type { ReactNode } from 'react';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'subtle' | 'danger';
  /** 宽版弹窗，用于字段较多的适配配置表单 */
  wide?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function Modal({
  open,
  title,
  children,
  confirmLabel = '确认',
  confirmVariant = 'danger',
  wide = false,
  onConfirm,
  onClose,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-6">
      <div
        className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-sm'} max-h-full overflow-y-auto p-4 shadow-lg`}
      >
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <div className="mt-2 text-[12px] text-muted">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
