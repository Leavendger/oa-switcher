import type { FlowStateSnapshot } from '../shared/types/flow';
import { isFlowStateSnapshot } from '../shared/messaging/protocol';
import { SESSION_KEYS } from './keys';

/** chrome.storage.session 不可用时的降级存储（随 Service Worker 生命周期存在） */
let memoryFallback: FlowStateSnapshot | null = null;

export async function readRun(): Promise<FlowStateSnapshot | null> {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEYS.run);
    const value: unknown = stored[SESSION_KEYS.run];
    if (isFlowStateSnapshot(value)) {
      memoryFallback = value;
      return value;
    }
    return memoryFallback;
  } catch {
    return memoryFallback;
  }
}

export async function writeRun(snapshot: FlowStateSnapshot | null): Promise<void> {
  memoryFallback = snapshot;
  try {
    if (snapshot) {
      await chrome.storage.session.set({ [SESSION_KEYS.run]: snapshot });
    } else {
      await chrome.storage.session.remove(SESSION_KEYS.run);
    }
  } catch {
    // 环境不支持 session storage 时使用内存降级，不影响流程本身
  }
}
