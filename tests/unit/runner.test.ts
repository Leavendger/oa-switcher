import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowRunner } from '../../src/background/flow/runner';
import { snapshotStore } from '../../src/background/flow/snapshotStore';
import type { FlowServices, FlowTarget } from '../../src/background/flow/steps';
import { isTerminalFlowState, type FlowStateSnapshot } from '../../src/shared/types/flow';
import type { AccountId, RunId, SystemId } from '../../src/shared/types/ids';
import { newRunId } from '../../src/shared/types/ids';
import { installChromeMock, type ChromeMock } from '../helpers/chromeMock';

const ACCOUNT_ID = 'acc_test' as AccountId;
const SYSTEM_ID = 'sys_test' as SystemId;

function makeTarget(runId: RunId): FlowTarget {
  return {
    runId,
    account: {
      id: ACCOUNT_ID,
      username: 'alice',
      displayName: 'Alice',
      systemId: SYSTEM_ID,
      groupId: null,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    } as unknown as FlowTarget['account'],
    system: {
      id: SYSTEM_ID,
      name: 'OA',
      vendor: 'landray',
      enabled: true,
      loginUrl: '',
      homeUrl: '',
      origins: [],
      adapterConfig: {},
      createdAt: 1,
      updatedAt: 1,
    } as unknown as FlowTarget['system'],
    password: 'secret-password',
    tabId: 1,
  };
}

function makeServices(overrides: Partial<FlowServices> = {}): FlowServices {
  return {
    resolve: vi.fn(async (_input, runId) => makeTarget(runId)),
    detectBlockers: vi.fn(async () => ({ blockedBy: null })),
    detectLoginState: vi.fn(async () => ({ state: 'loggedOut' as const, evidence: [] })),
    logout: vi.fn(async () => undefined),
    waitForLoginPage: vi.fn(async () => undefined),
    fillCredentials: vi.fn(async () => undefined),
    submitLogin: vi.fn(async () => undefined),
    verifyLogin: vi.fn(async () => ({ outcome: 'success' as const, evidence: [] })),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function waitForTerminal(runner: FlowRunner): Promise<FlowStateSnapshot> {
  await vi.waitFor(
    () => {
      const snapshot = runner.getSnapshot();
      expect(snapshot !== null && isTerminalFlowState(snapshot.state)).toBe(true);
    },
    { timeout: 2_000 },
  );
  const snapshot = runner.getSnapshot();
  if (!snapshot) throw new Error('missing snapshot');
  return snapshot;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('FlowRunner', () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  it('并发切换在非终态返回 E_FLOW_BUSY', async () => {
    const gate = deferred();
    const services = makeServices({
      detectLoginState: vi.fn(async () => {
        await gate.promise;
        return { state: 'loggedOut' as const, evidence: [] };
      }),
    });
    const runner = new FlowRunner({ services });

    const first = await runner.start({ accountId: ACCOUNT_ID });
    await vi.waitFor(() => {
      expect(runner.getSnapshot()?.state).toBe('probing');
    });

    await expect(runner.start({ accountId: ACCOUNT_ID })).rejects.toMatchObject({
      code: 'E_FLOW_BUSY',
    });
    expect(first.runId).toBeTruthy();

    gate.resolve();
    await waitForTerminal(runner);
  });

  it('已登录路径按顺序退出、等待登录页、填写、提交、验证成功', async () => {
    const order: string[] = [];
    let passwordAtFill: string | null = null;
    const services = makeServices({
      detectBlockers: vi.fn(async () => {
        order.push('blockers');
        return { blockedBy: null };
      }),
      detectLoginState: vi.fn(async () => {
        order.push('state');
        return { state: 'loggedIn' as const, evidence: [] };
      }),
      logout: vi.fn(async () => {
        order.push('logout');
      }),
      waitForLoginPage: vi.fn(async () => {
        order.push('page');
      }),
      fillCredentials: vi.fn(async (target) => {
        order.push('fill');
        passwordAtFill = target.password;
      }),
      submitLogin: vi.fn(async () => {
        order.push('submit');
      }),
      verifyLogin: vi.fn(async () => {
        order.push('verify');
        return { outcome: 'success' as const, evidence: [] };
      }),
    });
    const runner = new FlowRunner({ services });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('completed');
    expect(Object.keys(mock.session).length).toBeGreaterThan(0);
    expect(order).toEqual(['blockers', 'state', 'logout', 'page', 'fill', 'submit', 'verify']);
    expect(passwordAtFill).toBe('secret-password');
    expect(services.fillCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ account: expect.objectContaining({ username: 'alice' }) }),
      expect.any(Number),
    );
  });

  it('已登出路径跳过退出并直接进入登录页等待', async () => {
    const order: string[] = [];
    const services = makeServices({
      detectLoginState: vi.fn(async () => {
        order.push('state');
        return { state: 'loggedOut' as const, evidence: [] };
      }),
      logout: vi.fn(async () => {
        order.push('logout');
      }),
      waitForLoginPage: vi.fn(async () => {
        order.push('page');
      }),
    });
    const runner = new FlowRunner({ services });

    await runner.start({ accountId: ACCOUNT_ID });
    await waitForTerminal(runner);

    expect(order).toEqual(['state', 'page']);
    expect(services.logout).not.toHaveBeenCalled();
  });

  it('验证失败只认失败证据，不进入 completed', async () => {
    const services = makeServices({
      verifyLogin: async () => ({ outcome: 'failure', evidence: [] }),
    });
    const runner = new FlowRunner({ services });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('failed');
    expect(snapshot.error?.code).toBe('E_LOGIN_REJECTED');
  });

  it('验证结果 unknown 视为验证超时失败', async () => {
    const services = makeServices({
      verifyLogin: async () => ({ outcome: 'unknown', evidence: [] }),
    });
    const runner = new FlowRunner({ services });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('failed');
    expect(snapshot.error?.code).toBe('E_VERIFY_TIMEOUT');
  });

  it('验证码阻塞直接失败且不填写凭证', async () => {
    const services = makeServices({
      detectBlockers: async () => ({ blockedBy: 'captcha' }),
    });
    const runner = new FlowRunner({ services });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('failed');
    expect(snapshot.error?.code).toBe('E_BLOCKED_CAPTCHA');
    expect(services.fillCredentials).not.toHaveBeenCalled();
  });

  it('单步超时后失败，不会继续后续步骤', async () => {
    const services = makeServices({
      detectLoginState: () => new Promise<never>(() => undefined),
    });
    const runner = new FlowRunner({ services, stepTimeouts: { probe: 20 } });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('failed');
    expect(snapshot.error?.code).toBe('E_TIMEOUT');
    expect(services.fillCredentials).not.toHaveBeenCalled();
  });

  it('取消接到 runId 后立即落 cancelled，并通知服务清理', async () => {
    const gate = deferred();
    const services = makeServices({
      fillCredentials: vi.fn(async () => {
        await gate.promise;
      }),
    });
    const runner = new FlowRunner({ services });

    const { runId } = await runner.start({ accountId: ACCOUNT_ID });
    await vi.waitFor(() => {
      expect(runner.getSnapshot()?.state).toBe('filling');
    });

    await runner.cancel(runId);
    expect(runner.getSnapshot()?.state).toBe('cancelled');
    expect(services.cancel).toHaveBeenCalledWith(expect.objectContaining({ runId }), expect.any(Number));

    gate.resolve();
    const snapshot = await waitForTerminal(runner);
    expect(snapshot.state).toBe('cancelled');
    expect(services.submitLogin).not.toHaveBeenCalled();
    expect(services.verifyLogin).not.toHaveBeenCalled();
  });

  it('等待登录页超时映射为 E_LOGIN_PAGE_TIMEOUT', async () => {
    const services = makeServices({
      waitForLoginPage: () => new Promise<never>(() => undefined),
    });
    const runner = new FlowRunner({ services, stepTimeouts: { waitLoginPage: 20 } });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('failed');
    expect(snapshot.error?.code).toBe('E_LOGIN_PAGE_TIMEOUT');
  });

  it('验证步骤超时映射为 E_VERIFY_TIMEOUT', async () => {
    const services = makeServices({
      verifyLogin: () => new Promise<never>(() => undefined),
    });
    const runner = new FlowRunner({ services, stepTimeouts: { verify: 20 } });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('failed');
    expect(snapshot.error?.code).toBe('E_VERIFY_TIMEOUT');
  });

  it('取消后在目标解析完成前也不会触发 Content 清理', async () => {
    const gate = deferred();
    const services = makeServices({
      resolve: vi.fn(async (_input, runId) => {
        await gate.promise;
        return makeTarget(runId);
      }),
    });
    const runner = new FlowRunner({ services });

    const { runId } = await runner.start({ accountId: ACCOUNT_ID });
    await vi.waitFor(() => {
      expect(runner.getSnapshot()?.state).toBe('resolving');
    });

    await runner.cancel(runId);
    expect(runner.getSnapshot()?.state).toBe('cancelled');
    expect(services.cancel).not.toHaveBeenCalled();

    gate.resolve();
    await waitForTerminal(runner);
  });

  it('终态后再次取消返回 E_VALIDATION', async () => {
    const services = makeServices();
    const runner = new FlowRunner({ services });

    const { runId } = await runner.start({ accountId: ACCOUNT_ID });
    await waitForTerminal(runner);

    await expect(runner.cancel(runId)).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });

  it('终态钩子执行一次，失败也不改变 completed 结论', async () => {
    const afterTerminal = vi.fn(async () => {
      throw new Error('hook failure');
    });
    const services = makeServices({ afterTerminal });
    const runner = new FlowRunner({ services });

    await runner.start({ accountId: ACCOUNT_ID });
    const snapshot = await waitForTerminal(runner);

    expect(snapshot.state).toBe('completed');
    await vi.waitFor(() => {
      expect(afterTerminal).toHaveBeenCalledTimes(1);
    });
  });

  it('填写成功后从内存目标中清除密码', async () => {
    let observed: string | null = null;
    const services = makeServices({
      verifyLogin: vi.fn(async (target) => {
        observed = target.password;
        return { outcome: 'success' as const, evidence: [] };
      }),
    });
    const runner = new FlowRunner({ services });

    await runner.start({ accountId: ACCOUNT_ID });
    await waitForTerminal(runner);

    expect(observed).toBe('');
  });

  it('SW 重启后把非终态快照标记为 E_INTERRUPTED 且不续跑', async () => {
    const runId = newRunId();
    const interrupted: FlowStateSnapshot = {
      runId,
      state: 'filling',
      accountId: ACCOUNT_ID,
      systemId: SYSTEM_ID,
      step: 'fill',
      startedAt: 1,
      updatedAt: 1,
      deadlineAt: 10,
      error: null,
    };
    await snapshotStore.set(interrupted);

    const runner = new FlowRunner({ services: makeServices() });
    await runner.restore();

    const snapshot = runner.getSnapshot();
    expect(snapshot?.state).toBe('failed');
    expect(snapshot?.error?.code).toBe('E_INTERRUPTED');
  });
});
