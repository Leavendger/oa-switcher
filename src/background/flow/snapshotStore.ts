import { FLOW_TIMEOUTS } from '../../shared/constants';
import { log } from '../../shared/log';
import { isFlowError } from '../../shared/types/errors';
import type { FlowStateEvent, FlowStateSnapshot, VaultStateEvent } from '../../shared/types/flow';
import type { VaultState } from '../../shared/types/settings';
import { readRun, writeRun } from '../../storage/sessionRepo';

export class SnapshotStore {
  private snapshot: FlowStateSnapshot | null = null;
  private readonly ports = new Set<chrome.runtime.Port>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: FlowStateSnapshot | null = null;

  async load(): Promise<FlowStateSnapshot | null> {
    this.snapshot = await readRun();
    return this.snapshot;
  }

  get(): FlowStateSnapshot | null {
    return this.snapshot;
  }

  attach(port: chrome.runtime.Port): void {
    this.ports.add(port);
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
    });
    if (this.snapshot) this.post(port, this.snapshot);
  }

  async set(snapshot: FlowStateSnapshot | null): Promise<void> {
    this.snapshot = snapshot;
    this.pending = snapshot;
    this.scheduleFlush();
    try {
      await writeRun(snapshot);
    } catch (error) {
      // 持久化失败不阻断流程：内存快照与端口广播仍可用，只是 SW 回收后无法恢复
      log.warn('flow-snapshot-write-failed', {
        reason: isFlowError(error) ? error.code : 'unexpected-error',
      });
    }
  }

  /** 保险库状态变化广播：UI 收到后重拉权威状态，避免显示陈旧的「已解锁」。 */
  notifyVaultState(state: VaultState): void {
    const event: VaultStateEvent = { kind: 'evt', type: 'vault.state', state };
    for (const port of this.ports) {
      try {
        port.postMessage(event);
      } catch {
        this.ports.delete(port);
      }
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const snapshot = this.pending;
      this.pending = null;
      if (!snapshot) return;
      for (const port of this.ports) this.post(port, snapshot);
    }, FLOW_TIMEOUTS.snapshotDebounceMs);
  }

  private post(port: chrome.runtime.Port, snapshot: FlowStateSnapshot): void {
    const event: FlowStateEvent = {
      kind: 'evt',
      type: 'flow.state',
      runId: snapshot.runId,
      snapshot,
    };
    try {
      port.postMessage(event);
    } catch {
      this.ports.delete(port);
    }
  }
}

export const snapshotStore = new SnapshotStore();
