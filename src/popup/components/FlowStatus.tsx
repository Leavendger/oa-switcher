import {
  FLOW_STATE_LABELS,
  FLOW_STEP_LABELS,
  isTerminalFlowState,
  type FlowStateSnapshot,
} from '../../shared/types/flow';
import { errorText } from '../../errors/messages.zh-CN';
import { Button } from '../../ui/Button';

/** 只展示可安全暴露的结构化定位字段，绝不渲染原始 message。 */
const SAFE_DETAIL_KEYS = new Set([
  'step',
  'field',
  'missing',
  'reason',
  'origin',
  'systemId',
  'outcome',
  'stage',
]);

function detailText(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  const parts = Object.entries(detail)
    .filter(([key, value]) => SAFE_DETAIL_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface FlowStatusProps {
  snapshot: FlowStateSnapshot | null;
  onRetry?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
}

export function FlowStatus({ snapshot, onRetry, onCancel, cancelling }: FlowStatusProps) {
  if (!snapshot) return null;

  const failed = snapshot.state === 'failed';
  const running = !isTerminalFlowState(snapshot.state);
  const failureDetail = snapshot.error ? detailText(snapshot.error.detail) : null;

  return (
    <section className="card p-3" aria-live="polite">
      <header className="flex items-center justify-between">
        <h2 className="text-[12px] font-medium text-muted">切换状态</h2>
        <span className={`code text-[11px] ${failed ? 'text-danger' : 'text-muted'}`}>
          {snapshot.state}
        </span>
      </header>

      <p className="mt-1 text-[13px]">{FLOW_STATE_LABELS[snapshot.state]}</p>

      {snapshot.step ? (
        <p className="text-[11px] text-muted">当前步骤：{FLOW_STEP_LABELS[snapshot.step]}</p>
      ) : null}

      {snapshot.error ? (
        <div className="mt-1">
          <p className="text-[11px] text-danger">{errorText(snapshot.error.code)}</p>
          {failureDetail ? (
            <p className="code text-[10px] text-muted">{failureDetail}</p>
          ) : null}
        </div>
      ) : null}

      <p className="code mt-1 text-[10px] text-muted">
        runId {snapshot.runId} · 耗时 {Math.max(0, snapshot.updatedAt - snapshot.startedAt)} ms
      </p>

      {failed && onRetry ? (
        <Button className="mt-2" onClick={onRetry}>
          重试
        </Button>
      ) : null}

      {running && onCancel ? (
        <Button className="mt-2" onClick={onCancel} disabled={cancelling}>
          {cancelling ? '正在取消…' : '取消切换'}
        </Button>
      ) : null}
    </section>
  );
}
