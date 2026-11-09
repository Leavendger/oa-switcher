// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTransfer } from '../../src/background/services/transferExport';
import {
  importTransfer,
  previewTransferImport,
} from '../../src/background/services/transferImport';
import { vaultService } from '../../src/background/services/vaultService';
import { sealVault } from '../../src/crypto/vaultCrypto';
import type { Account, AccountGroup } from '../../src/shared/types/account';
import { FlowError, isFlowError } from '../../src/shared/types/errors';
import type { AccountId, GroupId, SystemId } from '../../src/shared/types/ids';
import type { OASystem } from '../../src/shared/types/system';
import type { FloatPrefs } from '../../src/shared/types/ui';
import type { TransferSettings } from '../../src/shared/types/transfer';
import { buildTransferFile } from '../../src/shared/transferPackage';
import { STORAGE_KEYS } from '../../src/storage/keys';
import { readFloatPrefs } from '../../src/background/services/uiPrefsService';
import {
  readAccounts,
  readGroups,
  readSettings,
  readSystems,
} from '../../src/storage/repo';
import { installChromeMock, type ChromeMock } from '../helpers/chromeMock';

const SOURCE_MASTER = 'source-master-123';
const LOCAL_MASTER = 'local-master-456';

const SYSTEM_A: OASystem = {
  id: 'sys_a' as SystemId,
  name: '系统 A',
  vendor: 'landray',
  enabled: true,
  origins: ['http://oa.a.test'],
  urlSignatures: ['/oa/*', '/portal/*'],
  loginUrl: 'http://oa.a.test/login.jsp',
  homeUrl: 'http://oa.a.test/home',
  adapterConfig: {
    preset: 'landray',
    login: { userSelector: '#username', passSelector: '#password', submitSelector: '#submit' },
    flags: { nested: { deep: true } },
  },
  permissionState: 'granted',
  originPermissions: { 'http://oa.a.test': 'granted' },
  createdAt: 100,
  updatedAt: 200,
};

const GROUP_A: AccountGroup = {
  id: 'grp_a' as GroupId,
  name: '分组 A',
  color: 'blue',
  sortOrder: 0,
  collapsedByDefault: false,
  createdAt: 100,
  updatedAt: 200,
};

const ACCOUNT_A: Account = {
  id: 'acc_a' as AccountId,
  label: '账号 A',
  username: 'alice',
  systemId: SYSTEM_A.id,
  groupId: GROUP_A.id,
  role: '管理员',
  note: '备注 A',
  enabled: true,
  sortOrder: 0,
  createdAt: 100,
  updatedAt: 200,
};

const BASE_SETTINGS: TransferSettings = {
  activeSystemId: SYSTEM_A.id,
  rememberedSystems: { 'http://oa.a.test/oa': SYSTEM_A.id },
  autoLockMinutes: 15,
  lockOnBrowserStart: true,
  lockAfterSwitch: false,
  confirmBeforeSwitch: true,
  theme: 'dark',
  auditEnabled: true,
  debugLogging: false,
  preferredPopupGrouping: 'grouped',
};

const BASE_FLOAT: FloatPrefs = {
  enabled: true,
  dismissed: { 'http://oa.a.test': true },
  positions: { 'http://oa.a.test': { x: 10, y: 20 } },
};

async function expectCode(action: Promise<unknown>, code: string): Promise<FlowError> {
  try {
    await action;
  } catch (error) {
    expect(isFlowError(error)).toBe(true);
    expect((error as FlowError).code).toBe(code);
    return error as FlowError;
  }
  throw new Error(`expected ${code}`);
}

async function makeEnvelope(
  master: string,
  entries: Record<string, string>,
): Promise<unknown> {
  const vaultEntries: Record<string, { password: string }> = {};
  for (const [id, password] of Object.entries(entries)) vaultEntries[id] = { password };
  const { envelope } = await sealVault(
    { schemaVersion: 1, entries: vaultEntries },
    master,
    { iterations: 100_000 },
  );
  return JSON.parse(JSON.stringify(envelope));
}

async function makeContent(input: {
  mode?: 'full' | 'config';
  systems?: OASystem[];
  accounts?: Account[];
  groups?: AccountGroup[];
  settings?: TransferSettings;
  float?: FloatPrefs;
  vault?: unknown;
}): Promise<string> {
  const file = await buildTransferFile({
    mode: input.mode ?? 'full',
    appVersion: '0.1.0-test',
    systems: input.systems ?? [],
    accounts: input.accounts ?? [],
    groups: input.groups ?? [],
    settings: input.settings ?? BASE_SETTINGS,
    float: input.float ?? BASE_FLOAT,
    vault: input.vault ?? null,
  });
  return JSON.stringify(file);
}

describe('导入备份', () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
    vaultService.resetRuntime();
    mock.local[STORAGE_KEYS.meta] = { schemaVersion: 1, installedAt: 1, updatedAt: 1 };
  });

  function seedLocal(input: {
    systems?: OASystem[];
    accounts?: Account[];
    groups?: AccountGroup[];
    settings?: unknown;
    float?: Partial<FloatPrefs>;
    envelope?: unknown;
  }): void {
    mock.local[STORAGE_KEYS.systems] = input.systems ?? [];
    mock.local[STORAGE_KEYS.accounts] = input.accounts ?? [];
    mock.local[STORAGE_KEYS.groups] = input.groups ?? [];
    if (input.settings !== undefined) mock.local[STORAGE_KEYS.settings] = input.settings;
    if (input.float?.enabled !== undefined) mock.local[STORAGE_KEYS.floatEnabled] = input.float.enabled;
    if (input.float?.dismissed !== undefined) mock.local[STORAGE_KEYS.floatDismissed] = input.float.dismissed;
    if (input.float?.positions !== undefined) mock.local[STORAGE_KEYS.floatPositions] = input.float.positions;
    if (input.envelope !== undefined) mock.local[STORAGE_KEYS.vault] = input.envelope;
  }

  function snapshot(): string {
    return JSON.stringify({
      systems: mock.local[STORAGE_KEYS.systems] ?? null,
      accounts: mock.local[STORAGE_KEYS.accounts] ?? null,
      groups: mock.local[STORAGE_KEYS.groups] ?? null,
      vault: mock.local[STORAGE_KEYS.vault] ?? null,
    });
  }

  it('完整包往返：配置深字段、urlSignatures、悬浮球偏好一致，且可用来源主密码解锁', async () => {
    const envelope = await makeEnvelope(SOURCE_MASTER, { [ACCOUNT_A.id]: 'alice-pass' });
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [ACCOUNT_A],
      groups: [GROUP_A],
      settings: { ...BASE_SETTINGS, schemaVersion: 1 },
      float: BASE_FLOAT,
      envelope,
    });

    const exported = await exportTransfer('full');
    mock.reset();
    mock.local[STORAGE_KEYS.meta] = { schemaVersion: 1, installedAt: 1, updatedAt: 1 };

    const result = await importTransfer({
      content: exported.content,
      conflict: 'keep-both',
      vault: 'adopt',
    });
    expect(result.vaultAction).toBe('adopted');
    expect(result.credentialsImported).toBe(true);

    const systems = await readSystems();
    const system = systems[0];
    if (!system) throw new Error('missing system');
    expect(system.name).toBe(SYSTEM_A.name);
    expect(system.adapterConfig).toEqual(SYSTEM_A.adapterConfig);
    expect(system.urlSignatures).toEqual(SYSTEM_A.urlSignatures);
    expect(system.origins).toEqual(SYSTEM_A.origins);
    expect(system.loginUrl).toBe(SYSTEM_A.loginUrl);

    const accounts = await readAccounts();
    const account = accounts[0];
    if (!account) throw new Error('missing account');
    expect(account.label).toBe(ACCOUNT_A.label);
    expect(account.username).toBe(ACCOUNT_A.username);
    expect(account.systemId).toBe(system.id);
    expect(account.groupId).not.toBeNull();

    const groups = await readGroups();
    const group = groups[0];
    if (!group) throw new Error('missing group');
    expect(group.name).toBe(GROUP_A.name);

    await expect(readFloatPrefs()).resolves.toEqual(BASE_FLOAT);

    vaultService.resetRuntime();
    await expect(vaultService.status()).resolves.toEqual({ state: 'locked' });
    await vaultService.unlock(SOURCE_MASTER);
    await expect(vaultService.readPassword(account.id)).resolves.toBe('alice-pass');
  });

  it('仅配置包：账号在、凭证不在，需要重新设置密码', async () => {
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [ACCOUNT_A],
      groups: [GROUP_A],
      settings: { ...BASE_SETTINGS, schemaVersion: 1 },
      float: BASE_FLOAT,
    });
    const exported = await exportTransfer('config');
    const parsed = JSON.parse(exported.content) as { vault: unknown };
    expect(parsed.vault).toBeNull();

    mock.reset();
    mock.local[STORAGE_KEYS.meta] = { schemaVersion: 1, installedAt: 1, updatedAt: 1 };
    mock.local[STORAGE_KEYS.vault] = await makeEnvelope(LOCAL_MASTER, {});

    const result = await importTransfer({
      content: exported.content,
      conflict: 'keep-both',
      vault: 'skip',
    });
    expect(result.credentialsImported).toBe(false);

    vaultService.resetRuntime();
    await vaultService.unlock(LOCAL_MASTER);
    const accounts = await readAccounts();
    const account = accounts[0];
    if (!account) throw new Error('missing account');
    await expectCode(vaultService.readPassword(account.id), 'E_CREDENTIAL_MISSING');
  });

  it('同 ID 冲突：覆盖保留本机密码；保留双方生成新 ID 并重映射引用', async () => {
    const localEnvelope = await makeEnvelope(LOCAL_MASTER, { [ACCOUNT_A.id]: 'local-pass' });
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [ACCOUNT_A],
      groups: [GROUP_A],
      envelope: localEnvelope,
    });

    const importedSystem: OASystem = { ...SYSTEM_A, name: '导入系统' };
    const importedGroup: AccountGroup = { ...GROUP_A, name: '导入分组' };
    const importedAccount: Account = { ...ACCOUNT_A, label: '导入账号', username: 'bob' };
    const content = await makeContent({
      mode: 'config',
      systems: [importedSystem],
      accounts: [importedAccount],
      groups: [importedGroup],
    });

    const preview = await previewTransferImport(content);
    expect(preview.renames).toEqual(
      expect.arrayContaining([
        { kind: 'system', from: '导入系统', to: '导入系统（导入）' },
        { kind: 'group', from: '导入分组', to: '导入分组（导入）' },
        { kind: 'account', from: '导入账号', to: '导入账号（导入）' },
      ]),
    );

    const overwrite = await importTransfer({
      content,
      conflict: 'overwrite',
      vault: 'skip',
    });
    expect(overwrite.overwritten).toEqual({ systems: 1, accounts: 1, groups: 1 });
    const overwrittenSystems = await readSystems();
    const overwrittenAccounts = await readAccounts();
    expect(overwrittenSystems).toHaveLength(1);
    expect(overwrittenSystems[0]?.name).toBe('导入系统');
    expect(overwrittenAccounts[0]?.username).toBe('bob');

    vaultService.resetRuntime();
    await vaultService.unlock(LOCAL_MASTER);
    await expect(vaultService.readPassword(ACCOUNT_A.id)).resolves.toBe('local-pass');

    // 重置为冲突前状态，验证「保留双方」
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [ACCOUNT_A],
      groups: [GROUP_A],
      envelope: localEnvelope,
    });
    const keepBoth = await importTransfer({ content, conflict: 'keep-both', vault: 'skip' });
    expect(keepBoth.keptBoth).toEqual({ systems: 1, accounts: 1, groups: 1 });
    expect(keepBoth.renamed).toHaveLength(3);

    const systems = await readSystems();
    const accounts = await readAccounts();
    const groups = await readGroups();
    expect(systems).toHaveLength(2);
    expect(accounts).toHaveLength(2);
    expect(groups).toHaveLength(2);

    const importedSystemCopy = systems.find((system) => system.name === '导入系统（导入）');
    const importedAccountCopy = accounts.find((account) => account.label === '导入账号（导入）');
    const importedGroupCopy = groups.find((group) => group.name === '导入分组（导入）');
    expect(importedSystemCopy).toBeTruthy();
    expect(importedAccountCopy?.systemId).toBe(importedSystemCopy?.id);
    expect(importedAccountCopy?.groupId).toBe(importedGroupCopy?.id);
  });

  it('版本过高、校验失败、引用非法都拒绝，且存储保持原样', async () => {
    seedLocal({ systems: [SYSTEM_A], accounts: [ACCOUNT_A], groups: [GROUP_A] });
    const content = await makeContent({
      mode: 'config',
      systems: [SYSTEM_A],
      accounts: [ACCOUNT_A],
      groups: [GROUP_A],
    });
    const before = snapshot();

    const tooNew = JSON.parse(content) as { version: number };
    tooNew.version = 2;
    await expectCode(
      importTransfer({ content: JSON.stringify(tooNew), conflict: 'keep-both', vault: 'skip' }),
      'E_TRANSFER_VERSION',
    );
    expect(snapshot()).toBe(before);

    const tampered = JSON.parse(content) as { data: { systems: { name: string }[] } };
    const tamperedSystem = tampered.data.systems[0];
    if (!tamperedSystem) throw new Error('missing tampered system');
    tamperedSystem.name = '被篡改';
    const tamperedError = await expectCode(
      importTransfer({ content: JSON.stringify(tampered), conflict: 'keep-both', vault: 'skip' }),
      'E_TRANSFER_INVALID',
    );
    expect(tamperedError.detail?.field).toBe('integrity');
    expect(tamperedError.detail?.reason).toBe('systems');
    expect(snapshot()).toBe(before);

    const badRef = await makeContent({
      mode: 'config',
      systems: [SYSTEM_A],
      accounts: [{ ...ACCOUNT_A, systemId: 'sys_missing' as SystemId }],
      groups: [GROUP_A],
    });
    const refError = await expectCode(
      importTransfer({ content: badRef, conflict: 'keep-both', vault: 'skip' }),
      'E_TRANSFER_INVALID',
    );
    expect(refError.detail?.field).toBe('accounts');
    expect(snapshot()).toBe(before);
  });

  it('写入失败时不产生部分写入', async () => {
    seedLocal({ systems: [SYSTEM_A], accounts: [ACCOUNT_A], groups: [GROUP_A] });
    const content = await makeContent({
      mode: 'config',
      systems: [SYSTEM_A],
      accounts: [ACCOUNT_A],
      groups: [GROUP_A],
    });
    const before = snapshot();
    const spy = vi
      .spyOn(chrome.storage.local, 'set')
      .mockRejectedValueOnce(new Error('quota-exceeded'));

    await expect(
      importTransfer({ content, conflict: 'overwrite', vault: 'skip' }),
    ).rejects.toThrow('quota-exceeded');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(snapshot()).toBe(before);
  });

  it('目标保险库未初始化：接管信封，用来源主密码解锁', async () => {
    const envelope = await makeEnvelope(SOURCE_MASTER, { [ACCOUNT_A.id]: 'alice-pass' });
    const content = await makeContent({
      systems: [SYSTEM_A],
      accounts: [ACCOUNT_A],
      groups: [GROUP_A],
      vault: envelope,
    });

    const result = await importTransfer({ content, conflict: 'keep-both', vault: 'adopt' });
    expect(result.vaultAction).toBe('adopted');
    expect(mock.local[STORAGE_KEYS.vault]).toEqual(envelope);

    vaultService.resetRuntime();
    await expect(vaultService.status()).resolves.toEqual({ state: 'locked' });
    await vaultService.unlock(SOURCE_MASTER);
    await expect(vaultService.readPassword(ACCOUNT_A.id)).resolves.toBe('alice-pass');
  });

  it('目标已初始化且主密码相同：合并双方凭证', async () => {
    const localAccount: Account = { ...ACCOUNT_A, id: 'acc_local' as AccountId, username: 'local' };
    const importedAccount: Account = { ...ACCOUNT_A, id: 'acc_import' as AccountId, username: 'imported' };
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [localAccount],
      groups: [GROUP_A],
      envelope: await makeEnvelope(SOURCE_MASTER, { 'acc_local': 'local-pass' }),
    });
    const content = await makeContent({
      systems: [{ ...SYSTEM_A, id: 'sys_import' as SystemId, name: '导入系统' }],
      accounts: [{ ...importedAccount, systemId: 'sys_import' as SystemId }],
      groups: [],
      vault: await makeEnvelope(SOURCE_MASTER, { 'acc_import': 'import-pass' }),
    });

    const preview = await previewTransferImport(content, SOURCE_MASTER);
    expect(preview.vault.passwordVerified).toBe(true);
    expect(preview.vault.sameAsTarget).toBe(true);
    expect(preview.vault.canMerge).toBe(true);

    const result = await importTransfer({
      content,
      conflict: 'keep-both',
      vault: 'merge',
      sourceMasterPassword: SOURCE_MASTER,
    });
    expect(result.vaultAction).toBe('merged');

    vaultService.resetRuntime();
    await vaultService.unlock(SOURCE_MASTER);
    await expect(vaultService.readPassword('acc_local' as AccountId)).resolves.toBe('local-pass');
    await expect(vaultService.readPassword('acc_import' as AccountId)).resolves.toBe('import-pass');
  });

  it('目标已初始化且主密码不同：合并被拒绝且零写入；只导入配置可用', async () => {
    const localAccount: Account = { ...ACCOUNT_A, id: 'acc_local' as AccountId, username: 'local' };
    const importedAccount: Account = { ...ACCOUNT_A, id: 'acc_import' as AccountId, username: 'imported' };
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [localAccount],
      groups: [GROUP_A],
      envelope: await makeEnvelope(LOCAL_MASTER, { 'acc_local': 'local-pass' }),
    });
    const content = await makeContent({
      systems: [{ ...SYSTEM_A, id: 'sys_import' as SystemId, name: '导入系统' }],
      accounts: [{ ...importedAccount, systemId: 'sys_import' as SystemId }],
      groups: [],
      vault: await makeEnvelope(SOURCE_MASTER, { 'acc_import': 'import-pass' }),
    });

    const preview = await previewTransferImport(content, SOURCE_MASTER);
    expect(preview.vault.passwordVerified).toBe(true);
    expect(preview.vault.sameAsTarget).toBe(false);
    expect(preview.vault.canMerge).toBe(false);

    const before = snapshot();
    await expectCode(
      importTransfer({
        content,
        conflict: 'keep-both',
        vault: 'merge',
        sourceMasterPassword: SOURCE_MASTER,
      }),
      'E_MASTER_INVALID',
    );
    expect(snapshot()).toBe(before);

    const skipped = await importTransfer({ content, conflict: 'keep-both', vault: 'skip' });
    expect(skipped.vaultAction).toBe('skipped');

    vaultService.resetRuntime();
    await vaultService.unlock(LOCAL_MASTER);
    await expect(vaultService.readPassword('acc_local' as AccountId)).resolves.toBe('local-pass');
  });

  it('清空本机保险库后导入：未二次确认被拒，确认后旧密码消失', async () => {
    const localAccount: Account = { ...ACCOUNT_A, id: 'acc_local' as AccountId, username: 'local' };
    const importedAccount: Account = { ...ACCOUNT_A, id: 'acc_import' as AccountId, username: 'imported' };
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [localAccount],
      groups: [GROUP_A],
      envelope: await makeEnvelope(LOCAL_MASTER, { 'acc_local': 'local-pass' }),
    });
    const content = await makeContent({
      systems: [SYSTEM_A],
      accounts: [importedAccount],
      groups: [],
      vault: await makeEnvelope(SOURCE_MASTER, { 'acc_import': 'import-pass' }),
    });

    const before = snapshot();
    const noConfirm = await expectCode(
      importTransfer({ content, conflict: 'keep-both', vault: 'replace' }),
      'E_VALIDATION',
    );
    expect(noConfirm.detail?.field).toBe('confirmReplace');
    expect(snapshot()).toBe(before);

    const replaced = await importTransfer({
      content,
      conflict: 'keep-both',
      vault: 'replace',
      confirmReplace: true,
    });
    expect(replaced.vaultAction).toBe('replaced');

    vaultService.resetRuntime();
    await vaultService.unlock(SOURCE_MASTER);
    await expect(vaultService.readPassword('acc_import' as AccountId)).resolves.toBe('import-pass');
    await expectCode(
      vaultService.readPassword('acc_local' as AccountId),
      'E_CREDENTIAL_MISSING',
    );
  });

  it('导入后 activeSystemId 回退到启用系统，失效 rememberedSystems 被清理', async () => {
    const disabled: OASystem = { ...SYSTEM_A, id: 'sys_disabled' as SystemId, name: '停用系统', enabled: false };
    const enabled: OASystem = { ...SYSTEM_A, id: 'sys_enabled' as SystemId, name: '启用系统' };
    const content = await makeContent({
      mode: 'config',
      systems: [disabled, enabled],
      accounts: [],
      groups: [],
      settings: {
        ...BASE_SETTINGS,
        activeSystemId: 'sys_missing' as SystemId,
        rememberedSystems: {
          'http://oa.a.test/oa': 'sys_missing' as SystemId,
          'http://oa.a.test/portal': 'sys_enabled' as SystemId,
        },
      },
    });

    const result = await importTransfer({ content, conflict: 'keep-both', vault: 'skip' });
    expect(result.activeSystemId).toBe('sys_enabled');
    const settings = await readSettings();
    expect(settings.activeSystemId).toBe('sys_enabled');
    expect(settings.rememberedSystems).toEqual({
      'http://oa.a.test/portal': 'sys_enabled',
    });
  });

  it('settings 本机优先：已有偏好不被覆盖，缺失项才补导入值', async () => {
    seedLocal({
      systems: [SYSTEM_A],
      accounts: [],
      groups: [],
      settings: { autoLockMinutes: 30 },
    });
    const content = await makeContent({
      mode: 'config',
      systems: [SYSTEM_A],
      accounts: [],
      groups: [],
      settings: { ...BASE_SETTINGS, autoLockMinutes: 5, theme: 'light' },
    });

    await importTransfer({ content, conflict: 'keep-both', vault: 'skip' });
    const settings = await readSettings();
    expect(settings.autoLockMinutes).toBe(30);
    expect(settings.theme).toBe('light');
  });
});
