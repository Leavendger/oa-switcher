// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultService, shouldAutoLock, vaultService } from '../../src/background/services/vaultService';
import { FlowError, isFlowError } from '../../src/shared/types/errors';
import type { AccountId } from '../../src/shared/types/ids';
import { STORAGE_KEYS } from '../../src/storage/keys';
import { writeSettings } from '../../src/storage/repo';
import { installChromeMock, type ChromeMock } from '../helpers/chromeMock';

const MASTER = 'master-secret-123';
const ACCOUNT_ID = 'acc_vault_test' as AccountId;

async function expectCode(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(isFlowError(error)).toBe(true);
    expect((error as FlowError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('VaultService', () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
    vaultService.resetRuntime();
  });

  it('初始化后解锁，只持久化密文', async () => {
    await expect(vaultService.status()).resolves.toEqual({ state: 'uninitialized' });
    await expect(vaultService.init(MASTER)).resolves.toEqual({ state: 'unlocked' });

    await vaultService.writePassword(ACCOUNT_ID, 'hunter2-account');
    await expect(vaultService.readPassword(ACCOUNT_ID)).resolves.toBe('hunter2-account');

    const raw = JSON.stringify(mock.local[STORAGE_KEYS.vault]);
    expect(raw).not.toContain('hunter2-account');
    expect(raw).not.toContain(MASTER);

    const envelope = mock.local[STORAGE_KEYS.vault] as { kdf: { iterations: number } };
    expect(envelope.kdf.iterations).toBe(600_000);
  });

  it('初始化参数非法 / 重复初始化被拒绝', async () => {
    await expectCode(vaultService.init('short'), 'E_VALIDATION');
    await vaultService.init(MASTER);
    await expectCode(vaultService.init(MASTER), 'E_VALIDATION');
  });

  it('未初始化时解锁返回 E_VAULT_NOT_INITIALIZED', async () => {
    await expectCode(vaultService.unlock(MASTER), 'E_VAULT_NOT_INITIALIZED');
  });

  it('错误主密码返回 E_MASTER_INVALID；正确密码可解锁', async () => {
    await vaultService.init(MASTER);
    await vaultService.lock();

    await expectCode(vaultService.unlock('wrong-master-pass'), 'E_MASTER_INVALID');
    await expectCode(vaultService.readPassword(ACCOUNT_ID), 'E_VAULT_LOCKED');

    await expect(vaultService.unlock(MASTER)).resolves.toEqual({ state: 'unlocked' });
    await vaultService.writePassword(ACCOUNT_ID, 'hunter2-account');
    await vaultService.lock();
    await expect(vaultService.unlock(MASTER)).resolves.toEqual({ state: 'unlocked' });
    await expect(vaultService.readPassword(ACCOUNT_ID)).resolves.toBe('hunter2-account');
  });

  it('SW 重启后新实例处于 locked，且需要重新解锁', async () => {
    await vaultService.init(MASTER);
    await vaultService.writePassword(ACCOUNT_ID, 'hunter2-account');

    const restarted = new VaultService();
    await expect(restarted.status()).resolves.toEqual({ state: 'locked' });
    await expectCode(restarted.readPassword(ACCOUNT_ID), 'E_VAULT_LOCKED');
    await expect(restarted.unlock(MASTER)).resolves.toEqual({ state: 'unlocked' });
    await expect(restarted.readPassword(ACCOUNT_ID)).resolves.toBe('hunter2-account');
  });

  it('修改主密码后旧密码失效，条目保留', async () => {
    await vaultService.init(MASTER);
    await vaultService.writePassword(ACCOUNT_ID, 'hunter2-account');

    await vaultService.changeMaster(MASTER, 'new-master-secret');
    const restarted = new VaultService();
    await expectCode(restarted.unlock(MASTER), 'E_MASTER_INVALID');
    await restarted.unlock('new-master-secret');
    await expect(restarted.readPassword(ACCOUNT_ID)).resolves.toBe('hunter2-account');
  });

  it('缺少条目时返回 E_CREDENTIAL_MISSING', async () => {
    await vaultService.init(MASTER);
    await expectCode(vaultService.readPassword(ACCOUNT_ID), 'E_CREDENTIAL_MISSING');
  });

  it('写密码要求已解锁', async () => {
    await vaultService.init(MASTER);
    await vaultService.lock();
    await expectCode(vaultService.writePassword(ACCOUNT_ID, 'x'), 'E_VAULT_LOCKED');
  });

  it('自动锁定阈值计算', () => {
    const now = 1_000_000;
    expect(shouldAutoLock(now - 15 * 60_000, now, 15)).toBe(true);
    expect(shouldAutoLock(now - 14 * 60_000, now, 15)).toBe(false);
    expect(shouldAutoLock(now - 60 * 60_000, now, 0)).toBe(false);
  });

  it('超过阈值后 maybeAutoLock 会锁定', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await writeSettings({ autoLockMinutes: 15 });
      await vaultService.init(MASTER);

      vi.setSystemTime(new Date('2026-01-01T00:16:00Z'));
      await vaultService.maybeAutoLock();
      await expect(vaultService.status()).resolves.toEqual({ state: 'locked' });
    } finally {
      vi.useRealTimers();
    }
  });
});
