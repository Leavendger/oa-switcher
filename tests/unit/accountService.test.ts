// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from '../../src/background/services/accountService';
import { vaultService } from '../../src/background/services/vaultService';
import { openVault, parseVaultEnvelope } from '../../src/crypto/vaultCrypto';
import { FlowError, isFlowError } from '../../src/shared/types/errors';
import type { AccountDraft } from '../../src/shared/types/account';
import type { SystemId } from '../../src/shared/types/ids';
import { newSystemId } from '../../src/shared/types/ids';
import type { OASystem } from '../../src/shared/types/system';
import { STORAGE_KEYS } from '../../src/storage/keys';
import { readAccounts, writeSystems } from '../../src/storage/repo';
import { installChromeMock, type ChromeMock } from '../helpers/chromeMock';

const MASTER = 'master-secret-123';
const PASSWORD = 'hunter2-account';

let systemId: SystemId;
let mock: ChromeMock;

function systemFixture(): OASystem {
  systemId = newSystemId();
  return {
    id: systemId,
    name: 'OA',
    vendor: 'landray',
    enabled: true,
    origins: ['https://oa.example.com'],
    loginUrl: 'https://oa.example.com/login',
    homeUrl: null,
    adapterConfig: {},
    permissionState: 'unknown',
    urlSignatures: [],
    originPermissions: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function draft(overrides: Partial<AccountDraft> = {}): AccountDraft {
  return {
    label: '主账号',
    username: 'alice',
    systemId,
    groupId: null,
    role: null,
    note: null,
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

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

async function decryptEntries(): Promise<number> {
  const envelope = parseVaultEnvelope(mock.local[STORAGE_KEYS.vault]);
  if (!envelope) return 0;
  const opened = await openVault(envelope, MASTER);
  return Object.keys(opened.plaintext.entries).length;
}

describe('accountService', () => {
  beforeEach(async () => {
    mock = installChromeMock();
    vaultService.resetRuntime();
    const system = systemFixture();
    await writeSystems([system]);
  });

  it('无密码创建只写元数据，不要求解锁、不触碰保险库', async () => {
    await createAccount(draft());
    const accounts = await readAccounts();
    expect(accounts).toHaveLength(1);
    expect(mock.local[STORAGE_KEYS.vault]).toBeUndefined();
  });

  it('带密码创建在未解锁时返回 E_VAULT_LOCKED', async () => {
    await expectCode(createAccount(draft({ password: PASSWORD })), 'E_VAULT_LOCKED');
    await expect(readAccounts()).resolves.toHaveLength(0);
  });

  it('解锁后带密码创建，密文中不含明文', async () => {
    await vaultService.init(MASTER);
    const account = await createAccount(draft({ password: PASSWORD }));

    expect(await decryptEntries()).toBe(1);
    const raw = JSON.stringify(mock.local[STORAGE_KEYS.vault]);
    expect(raw).not.toContain(PASSWORD);
    await expect(vaultService.readPassword(account.id)).resolves.toBe(PASSWORD);
  });

  it('(systemId, username) 唯一', async () => {
    await createAccount(draft());
    await expectCode(createAccount(draft({ label: '另一个' })), 'E_VALIDATION');
  });

  it('字段校验：空 label / 不存在的 system', async () => {
    await expectCode(createAccount(draft({ label: '   ' })), 'E_VALIDATION');
    await expectCode(
      createAccount(draft({ systemId: 'sys_missing' as SystemId })),
      'E_VALIDATION',
    );
  });

  it('元数据更新不需要解锁，且不改写密文', async () => {
    await vaultService.init(MASTER);
    const account = await createAccount(draft({ password: PASSWORD }));
    await vaultService.lock();

    const before = JSON.stringify(mock.local[STORAGE_KEYS.vault]);
    const next = draft({ label: '改名后', password: undefined });
    const updated = await updateAccount(account.id, next);
    expect(updated.label).toBe('改名后');
    expect(JSON.stringify(mock.local[STORAGE_KEYS.vault])).toBe(before);
  });

  it('带新密码更新需要解锁，并保留其他字段', async () => {
    await vaultService.init(MASTER);
    const account = await createAccount(draft({ password: PASSWORD }));

    await updateAccount(account.id, draft({ label: '新标签', password: 'next-password' }));
    await expect(vaultService.readPassword(account.id)).resolves.toBe('next-password');

    const accounts = await readAccounts();
    expect(accounts[0]?.label).toBe('新标签');
  });

  it('解锁时删除账号同时清理保险库条目', async () => {
    await vaultService.init(MASTER);
    const account = await createAccount(draft({ password: PASSWORD }));
    const before = JSON.stringify(mock.local[STORAGE_KEYS.vault]);

    const result = await deleteAccount(account.id);
    await expect(listAccounts()).resolves.toHaveLength(0);
    expect(result.credentialRemoved).toBe(true);
    expect(JSON.stringify(mock.local[STORAGE_KEYS.vault])).not.toBe(before);
    expect(await decryptEntries()).toBe(0);
  });

  it('锁定删除只移除元数据，保留孤儿条目且不强行解密', async () => {
    await vaultService.init(MASTER);
    const account = await createAccount(draft({ password: PASSWORD }));
    await vaultService.lock();
    const before = JSON.stringify(mock.local[STORAGE_KEYS.vault]);

    const result = await deleteAccount(account.id);
    await expect(listAccounts()).resolves.toHaveLength(0);
    expect(result.credentialRemoved).toBe(false);
    expect(JSON.stringify(mock.local[STORAGE_KEYS.vault])).toBe(before);
    expect(await decryptEntries()).toBe(1);
  });

  it('元数据写入失败时回滚刚写入的保险库条目', async () => {
    await vaultService.init(MASTER);
    const area = chrome.storage.local as unknown as {
      set: (items: Record<string, unknown>) => Promise<void>;
    };
    const originalSet = area.set.bind(area);
    let failNext = true;
    area.set = async (items) => {
      if (failNext && STORAGE_KEYS.accounts in items) {
        failNext = false;
        throw new Error('simulated write failure');
      }
      await originalSet(items);
    };

    try {
      await expectCode(createAccount(draft({ password: PASSWORD })), 'E_INTERNAL');
    } finally {
      area.set = originalSet;
    }

    await expect(readAccounts()).resolves.toHaveLength(0);
    expect(await decryptEntries()).toBe(0);
  });
});

describe('删除分组对账号的影响', () => {
  it('删除分组后账号 groupId 变为 null', async () => {
    const { createGroup, deleteGroup } = await import('../../src/background/services/groupService');
    mock = installChromeMock();
    vaultService.resetRuntime();
    await writeSystems([systemFixture()]);

    const group = await createGroup({
      name: '测试组',
      color: 'blue',
      sortOrder: 0,
      collapsedByDefault: false,
    });
    const account = await createAccount(draft({ groupId: group.id }));

    await deleteGroup(group.id);
    const accounts = await readAccounts();
    expect(accounts.find((item) => item.id === account.id)?.groupId).toBeNull();
  });
});
