import type { SystemId } from '../../shared/types/ids';
import type { OASystem } from '../../shared/types/system';

export interface OtherSystemsPanelProps {
  systems: OASystem[];
  activeSystemId: SystemId | null;
  selectedId: SystemId | null;
  accountCounts: Record<string, number>;
  open: boolean;
  onToggle: () => void;
  onSelectSystem: (id: SystemId) => void;
}

/** 「查看其他系统」折叠入口：仅浏览与选择，真正切换前仍会校验当前页归属。 */
export function OtherSystemsPanel({
  systems,
  activeSystemId,
  selectedId,
  accountCounts,
  open,
  onToggle,
  onSelectSystem,
}: OtherSystemsPanelProps) {
  const others = systems.filter((system) => system.id !== activeSystemId);

  if (others.length === 0) return null;

  return (
    <div className="card p-2" data-testid="other-systems">
      <button
        type="button"
        className="flex w-full items-center justify-between px-1 text-[11px] font-medium text-muted"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>查看其他系统</span>
        <span>{open ? '收起' : '展开'}</span>
      </button>

      {open ? (
        <ul className="mt-1 flex flex-col gap-1">
          {others.map((system) => (
            <li key={system.id}>
              <button
                type="button"
                aria-pressed={system.id === selectedId}
                className={`flex w-full items-center justify-between rounded-oa border px-2 py-1.5 text-left text-[12px] ${
                  system.id === selectedId ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg'
                }`}
                onClick={() => onSelectSystem(system.id)}
              >
                <span>{system.name}</span>
                <span className="text-[10px] text-muted">{accountCounts[system.id] ?? 0} 个账号</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
