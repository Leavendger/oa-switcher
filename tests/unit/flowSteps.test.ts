// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlowServices, type FlowTarget } from '../../src/background/flow/steps';
import { vaultService } from '../../src/background/services/vaultService';
import { FlowError, isFlowError } from '../../src/shared/types/errors';
import type { Account } from '../../src/shared/types/account';
import { newAccountId, newRunId, newSystemId } from '../../src/shared/types/ids';
import type { OASystem } from '../../src/shared/types/system';
import { writeAccounts, writeSystems } from '../../src/storage/repo';
import { installChromeMock } from '../helpers/chromeMock';

const MASTER = 'master-secret-123';
const PASSWORD = 'account-secret';
const ACCOUNT_ID = newAccountId();
const SYSTEM_ID = newSystemId();
const OTHER_SYSTEM_ID = newSystemId();

function systemFixture(overrides: Partial<OASystem> = {}): OASystem {
  return {
    id: SYSTEM_ID,
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
    ...overrides,
  };
}

function accountFixture(overrides: Partial<Account> = {}): Account {
  return {
    id: ACCOUNT_ID,
    label: '主账号',
    username: 'alice',
    systemId: SYSTEM_ID,
    groupId: null,
    role: null,
    note: null,
    enabled: true,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
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

async function seed(options: {
  account?: Partial<Account>;
  system?: Partial<OASystem>;
  skipPasswordEntry?: boolean;
} = {}): Promise<void> {
  await writeSystems([systemFixture(options.system)]);
  await writeAccounts([accountFixture(options.account)]);
  await vaultService.init(MASTER);
  if (!options.skipPasswordEntry) await vaultService.writePassword(ACCOUNT_ID, PASSWORD);
}

describe('flow steps resolve', () => {
  beforeEach(() => {
    installChromeMock();
    vaultService.resetRuntime();
  });

  it('保险库锁定时在触达页面前返回 E_VAULT_LOCKED', async () => {
    await seed();
    await vaultService.lock();

    await expectCode(
      createFlowServices().resolve({ accountId: ACCOUNT_ID }, newRunId()),
      'E_VAULT_LOCKED',
    );
  });

  it('账号未启用时返回 E_VALIDATION', async () => {
    await seed({ account: { enabled: false } });
    await expectCode(
      createFlowServices().resolve({ accountId: ACCOUNT_ID }, newRunId()),
      'E_VALIDATION',
    );
  });

  it('系统未启用时返回 E_VALIDATION', async () => {
    await seed({ system: { enabled: false } });
    await expectCode(
      createFlowServices().resolve({ accountId: ACCOUNT_ID }, newRunId()),
      'E_VALIDATION',
    );
  });

  it('请求的系统与账号归属不一致时返回 E_VALIDATION', async () => {
    await seed();
    await expectCode(
      createFlowServices().resolve({ accountId: ACCOUNT_ID, systemId: OTHER_SYSTEM_ID }, newRunId()),
      'E_VALIDATION',
    );
  });

  it('账号没有密码条目时返回 E_CREDENTIAL_MISSING', async () => {
    await seed({ skipPasswordEntry: true });
    await expectCode(
      createFlowServices().resolve({ accountId: ACCOUNT_ID }, newRunId()),
      'E_CREDENTIAL_MISSING',
    );
  });

  it('域名权限未授予时返回 E_NO_PERMISSION', async () => {
    await seed();
    const contains = vi.spyOn(chrome.permissions, 'contains') as unknown as {
      mockResolvedValue: (value: boolean) => void;
    };
    contains.mockResolvedValue(false);

    await expectCode(
      createFlowServices().resolve({ accountId: ACCOUNT_ID }, newRunId()),
      'E_NO_PERMISSION',
    );
  });

  it('未找到对应活动 OA 标签页时返回 E_NO_OA_TAB', async () => {
    await seed();

    await expectCode(
      createFlowServices().resolve({ accountId: ACCOUNT_ID }, newRunId()),
      'E_NO_OA_TAB',
    );
  });
});

describe('flow steps 页面跳转容错', () => {
  const target: FlowTarget = {
    runId: newRunId(),
    account: accountFixture(),
    system: systemFixture(),
    password: PASSWORD,
    tabId: 7,
  };

  beforeEach(() => {
    installChromeMock();
  });

  type Message = { id: string; type: string };
  function mockSendMessage(handler: (message: Message) => unknown): void {
    (chrome.tabs as unknown as { sendMessage: (tabId: number, message: Message) => Promise<unknown> }).sendMessage =
      async (_tabId, message) => handler(message);
  }

  const pingOk = (message: Message) => ({
    kind: 'res',
    id: message.id,
    ok: true,
    data: {
      url: 'https://oa.example.com/login',
      title: '',
      ready: true,
      frame: 'top',
      adapterVersion: 'test',
    },
  });
  const responseOk = (message: Message, data: unknown) => ({
    kind: 'res',
    id: message.id,
    ok: true,
    data,
  });
  const navigationLost = (message: Message) => {
    if (message.type === 'content.ping') return pingOk(message);
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };

  it('verifyLogin 在导航导致响应丢失后重试并保留判定结果', async () => {
    let attempts = 0;
    mockSendMessage((message) => {
      if (message.type === 'content.ping') return pingOk(message);
      if (message.type !== 'oa.verifyLogin') throw new Error(`unexpected:${message.type}`);
      attempts += 1;
      if (attempts === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return responseOk(message, { outcome: 'success', evidence: [] });
    });

    const result = await createFlowServices().verifyLogin(target, Date.now() + 3000, 3000);
    expect(result.outcome).toBe('success');
    expect(attempts).toBe(2);
  });

  it('verifyLogin 持续通信失败时在截止时间抛 E_TIMEOUT', async () => {
    mockSendMessage(navigationLost);
    await expectCode(createFlowServices().verifyLogin(target, Date.now() + 500, 500), 'E_TIMEOUT');
  });

  it('submitLogin 与 logout 容忍导航导致的响应丢失', async () => {
    mockSendMessage(navigationLost);
    const services = createFlowServices();
    await expect(services.submitLogin(target, 100)).resolves.toBeUndefined();
    await expect(services.logout(target, 100)).resolves.toBeUndefined();
  });

  it('waitForLoginPage 持续通信失败时抛 E_LOGIN_PAGE_TIMEOUT', async () => {
    mockSendMessage(navigationLost);
    await expectCode(createFlowServices().waitForLoginPage(target, 400), 'E_LOGIN_PAGE_TIMEOUT');
  });
});
