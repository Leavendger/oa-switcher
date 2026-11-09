import { Button } from '../../ui/Button';

export interface SwitchButtonProps {
  disabledReason: string | null;
  busy: boolean;
  onClick: () => void;
}

export function SwitchButton({ disabledReason, busy, onClick }: SwitchButtonProps) {
  const disabled = disabledReason !== null || busy;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="primary"
        disabled={disabled}
        aria-disabled={disabled}
        title={disabledReason ?? '开始切换'}
        onClick={onClick}
      >
        {busy ? '切换中…' : '切换账号'}
      </Button>
      {disabledReason ? <p className="text-[11px] text-muted">{disabledReason}</p> : null}
    </div>
  );
}
