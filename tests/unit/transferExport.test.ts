// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportTransfer } from '../../src/background/services/transferExport';
import { sealVault } from '../../src/crypto/vaultCrypto';
import type { Account, AccountGroup } from '../../src/shared/types/account';
import { FlowError, isFlowError } from '../../src/shared/types/errors';
import type { AccountId, GroupId, SystemId } from '../../src/shared/types/ids';
import type { Settings } from '../../src/shared/types/settings';
import type { OASystem } from '../../src/shared/types/system';
import { verifyTransferFile } from '../../src/shared/transferPackage';
import { STORAGE_KEYS } from '../../src/storage/keys';
import { installChromeMock, type ChromeMock } from '../helpers/chromeMock';

const MASTER = 'master-secret-123';
const PASSWORD = 'account-secret-456';
const SYSTEM_ID = 'sys_export' as SystemId;
const GROUP_ID = 'grp_export' as GroupId;
const ACCOUNT_ID = 'acc_export' as AccountId;

const SYSTEM: OASystem = {
  id: SYSTEM_ID,
  name: '导出测试系统',
  vendor: 'landray',
  enabled: true,
  origins: ['http://oa.export.test'],
  urlSignatures: ['/oa/*'],
  loginUrl: 'http://oa.export.test/login.jsp',
  homeUrl: 'http://oa.export.test/home',
  adapterConfig: {
    preset: 'landray',
    login: { userSelector: '#username', passSelector: '#password' },
    timeouts: { probe: 1_000 },
  },
  permissionState: 'granted',
  originPermissions: { 'http://oa.export.test': 'granted' },
  createdAt: 1,
  updatedAt: 2,
};

const GROUP: AccountGroup = {
  id: GROUP_ID,
  name: '常用',
  color: 'blue',
  sortOrder: 0,
  collapsedByDefault: false,
  createdAt: 1,
  updatedAt: 2,
};

const ACCOUNT: Account = {
  id: ACCOUNT_ID,
  label: '测试账号',
  username: 'alice',
  systemId: SYSTEM_ID,
  groupId: GROUP_ID,
  role: '管理员',
  note: '备注',
  enabled: true,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 2,
};

const SETTINGS: Settings = {
  schemaVersion: 1,
  activeSystemId: SYSTEM_ID,
  rememberedSystems: { 'http://oa.export.test/oa': SYSTEM_ID },
  autoLockMinutes: 15,
  lockOnBrowserStart: true,
  lockAfterSwitch: false,
  confirmBeforeSwitch: true,
  theme: 'dark',
  auditEnabled: true,
  debugLogging: false,
  preferredPopupGrouping: 'grouped',
};

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

function seed(mock: ChromeMock, envelope: unknown): void {
  mock.local[STORAGE_KEYS.systems] = [SYSTEM];
  mock.local[STORAGE_KEYS.accounts] = [ACCOUNT];
  mock.local[STORAGE_KEYS.groups] = [GROUP];
  mock.local[STORAGE_KEYS.settings] = SETTINGS;
  mock.local[STORAGE_KEYS.floatEnabled] = true;
  mock.local[STORAGE_KEYS.floatDismissed] = { 'http://oa.export.test': true };
  mock.local[STORAGE_KEYS.floatPositions] = { 'http://oa.export.test': { x: 10, y: 20 } };
  mock.local[STORAGE_KEYS.vault] = envelope;
}

async function makeEnvelope(): Promise<unknown> {
  const { envelope } = await sealVault(
    { schemaVersion: 1, entries: { [ACCOUNT_ID]: { password: PASSWORD } } },
    MASTER,
    { iterations: 100_000 },
  );
  return JSON.parse(JSON.stringify(envelope));
}

describe('导出备份', () => {
  let mock: ChromeMock;
  let envelope: unknown;

  beforeEach(async () => {
    mock = installChromeMock();
    envelope = await makeEnvelope();
    seed(mock, envelope);
  });

  it('完整模式原样包含信封，且文件内没有明文密码或主密码', async () => {
    const exported = await exportTransfer('full');
    const parsed = JSON.parse(exported.content) as Record<string, unknown>;

    expect(parsed.mode).toBe('full');
    expect(parsed.vault).toEqual(envelope);
    expect(exported.content).not.toContain(PASSWORD);
    expect(exported.content).not.toContain(MASTER);
    expect(exported.bytes).toBeGreaterThan(0);

    const verified = await verifyTransferFile(parsed);
    expect(verified.integrity.sections.systems.count).toBe(1);
    expect(verified.integrity.sections.accounts.count).toBe(1);
    expect(verified.integrity.sections.groups.count).toBe(1);
    expect(verified.integrity.sections.vault.count).toBe(1);
  });

  it('仅配置模式不含任何保险库字段，且体积更小', async () => {
    const full = await exportTransfer('full');
    const config = await exportTransfer('config');
    const parsed = JSON.parse(config.content) as Record<string, unknown>;

    expect(parsed.mode).toBe('config');
    expect(parsed.vault).toBeNull();
    expect((parsed.integrity as { sections: { vault: { count: number } } }).sections.vault.count).toBe(0);
    expect(config.content).not.toContain(PASSWORD);
    expect(config.content).not.toContain('ciphertextB64');
    expect(config.bytes).toBeLessThan(full.bytes);
    await expect(verifyTransferFile(parsed)).resolves.toBeTruthy();
  });

  it('导出模块源码不引用任何解密能力', () => {
    const source = readFileSync(
      new URL('../../src/background/services/transferExport.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/vaultCrypto/);
    expect(source).not.toMatch(/openVault|deriveVaultKey|decrypt|readPassword|resealWithKey/);
  });

  it('篡改任一段会被完整性校验指出具体段名；版本过高单独拒绝', async () => {
    const exported = await exportTransfer('full');
    const tampered = JSON.parse(exported.content) as {
      data: { systems: { name: string }[] };
      version: number;
    };
    const tamperedSystem = tampered.data.systems[0];
    if (!tamperedSystem) throw new Error('missing tampered system');
    tamperedSystem.name = '被篡改';

    try {
      await verifyTransferFile(tampered);
      throw new Error('篡改数据不应通过');
    } catch (error) {
      expect(isFlowError(error)).toBe(true);
      expect((error as FlowError).code).toBe('E_TRANSFER_INVALID');
      expect((error as FlowError).detail?.field).toBe('integrity');
      expect((error as FlowError).detail?.reason).toBe('systems');
    }

    const tooNew = JSON.parse(exported.content) as { version: number };
    tooNew.version = 2;
    await expectCode(verifyTransferFile(tooNew), 'E_TRANSFER_VERSION');
  });
});
