import type { SystemId } from '../../shared/types/ids';
import type { SystemCandidate } from '../../shared/types/system';
import { Button } from '../../ui/Button';

export interface SystemPickerProps {
  candidates: SystemCandidate[];
  selectedId: SystemId | null;
  remember: boolean;
  busy?: boolean;
  onSelect: (id: SystemId) => void;
  onRememberChange: (value: boolean) => void;
  onConfirm: () => void;
}

/** 同域多系统无法区分时的系统选择器；记忆范围由 Background 按 origin + 路径前缀保存。 */
export function SystemPicker({
  candidates,
  selectedId,
  remember,
  busy,
  onSelect,
  onRememberChange,
  onConfirm,
}: SystemPickerProps) {
  return (
    <div className="card p-3" data-testid="system-picker">
      <p className="text-[13px] font-medium">多个系统匹配当前页面</p>
      <p className="mt-1 text-[11px] text-muted">
        请选择当前页面所属系统。若选择「记住」，只在当前路径前缀内生效。
      </p>

      <ul className="mt-2 flex flex-col gap-1">
        {candidates.map((candidate) => {
          const selected = candidate.systemId === selectedId;
          return (
            <li key={candidate.systemId}>
              <button
                type="button"
                aria-pressed={selected}
                className={`w-full rounded-oa border px-2 py-1.5 text-left text-[12px] ${
                  selected ? 'border-accent bg-accent/10' : 'border-border'
                }`}
                onClick={() => onSelect(candidate.systemId)}
              >
                {candidate.name}
              </button>
            </li>
          );
        })}
      </ul>

      <label className="mt-2 flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => onRememberChange(event.target.checked)}
        />
        记住本次选择（仅当前路径前缀）
      </label>

      <Button className="mt-2" variant="primary" disabled={busy || selectedId === null} onClick={onConfirm}>
        使用所选系统
      </Button>
    </div>
  );
}
