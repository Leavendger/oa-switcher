import { snapshotStore } from '../flow/snapshotStore';
import { vaultService } from './vaultService';

/**
 * 读取后台权威保险库状态并广播给已连接的 UI。
 * 用于初始化完成、解锁/锁定/改密、自动锁定之后，让 Popup 与悬浮球同步。
 */
export async function notifyVaultState(): Promise<void> {
  const status = await vaultService.status();
  snapshotStore.notifyVaultState(status.state);
}
