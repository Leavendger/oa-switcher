import { log } from '../../shared/log';
import type { Account } from '../../shared/types/account';
import { FlowError, isFlowError } from '../../shared/types/errors';
import type { AccountId, RunId, SystemId } from '../../shared/types/ids';
import type {
  BlockerReport,
  LoginStateReport,
  LoginVerification,
  OaRequestBase,
} from '../../shared/types/messages';
import type { OASystem } from '../../shared/types/system';
import { readAccounts, readSettings, readSystems } from '../../storage/repo';
import { cancelOaRun, resolveOaTab, sendOaCommand } from '../contentMessenger';
import { vaultService } from '../services/vaultService';

export interface FlowStartInput {
  accountId: AccountId;
  systemId?: SystemId;
}

export interface FlowTarget {
  runId: RunId;
  account: Account;
  system: OASystem;
  /** 只保存在内存，用于本次填写；绝不写回 storage 或快照。 */
  password: string;
  tabId: number;
}

/** Runner 的唯一外部依赖；测试可注入假实现，真实实现见 createFlowServices。 */
export interface FlowServices {
  resolve(input: FlowStartInput, runId: RunId): Promise<FlowTarget>;
  detectBlockers(target: FlowTarget, timeoutMs: number): Promise<BlockerReport>;
  detectLoginState(target: FlowTarget, timeoutMs: number): Promise<LoginStateReport>;
  logout(target: FlowTarget, timeoutMs: number): Promise<void>;
  waitForLoginPage(target: FlowTarget, timeoutMs: number): Promise<void>;
  fillCredentials(target: FlowTarget, timeoutMs: number): Promise<void>;
  submitLogin(target: FlowTarget, timeoutMs: number): Promise<void>;
  verifyLogin(target: FlowTarget, deadlineAt: number, timeoutMs: number): Promise<LoginVerification>;
  cancel(target: FlowTarget, timeoutMs: number): Promise<void>;
  /** 终态副作用（如 lockAfterSwitch）；失败不得影响流程结果。 */
  afterTerminal?(): Promise<void>;
}

/** 页面跳转时消息响应会丢失，重试间隔略大于一次性导航的常见耗时。 */
const CONTENT_RETRY_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isContentUnavailable(error: unknown): boolean {
  return isFlowError(error) && error.code === 'E_CONTENT_UNAVAILABLE';
}

/**
 * 页面导航会让发送中的消息丢失（send-failed）。读类命令不产生副作用，
 * 在截止时间内重试，直到页面恢复可通信；超时后抛业务超时错误。
 */
async function retryOnContentUnavailable<T>(
  deadlineAt: number,
  work: () => Promise<T>,
  onExhausted: () => FlowError,
): Promise<T> {
  for (;;) {
    try {
      return await work();
    } catch (error) {
      if (!isContentUnavailable(error)) throw error;
      if (Date.now() >= deadlineAt) throw onExhausted();
      await delay(CONTENT_RETRY_DELAY_MS);
    }
  }
}

function requestBase(target: FlowTarget): OaRequestBase {
  return {
    runId: target.runId,
    systemId: target.system.id,
    vendor: target.system.vendor,
    adapterConfig: target.system.adapterConfig,
  };
}

async function resolveTarget(input: FlowStartInput, runId: RunId): Promise<FlowTarget> {
  const accounts = await readAccounts();
  const account = accounts.find((item) => item.id === input.accountId);
  if (!account) throw new FlowError('E_VALIDATION', { field: 'accountId' });
  if (!account.enabled) throw new FlowError('E_VALIDATION', { field: 'accountId', reason: 'disabled' });

  const systems = await readSystems();
  const system = systems.find((item) => item.id === account.systemId);
  if (!system) throw new FlowError('E_VALIDATION', { field: 'systemId', reason: 'missing' });
  if (input.systemId !== undefined && input.systemId !== system.id) {
    throw new FlowError('E_VALIDATION', { field: 'systemId', reason: 'account-system-mismatch' });
  }
  if (!system.enabled) throw new FlowError('E_VALIDATION', { field: 'systemId', reason: 'disabled' });

  // 懒解锁的最终闸门：未解锁时在触达页面前失败，明文只在内存停留
  const password = await vaultService.readPassword(account.id);
  const tabId = await resolveOaTab(system);

  return { runId, account, system, password, tabId };
}

/** 真实实现：Background 只做编排，所有页面操作都通过 Content Script。 */
export function createFlowServices(): FlowServices {
  return {
    resolve: resolveTarget,

    detectBlockers: (target, timeoutMs) =>
      sendOaCommand(
        target.tabId,
        'oa.detectBlockers',
        requestBase(target),
        timeoutMs,
      ),

    detectLoginState: (target, timeoutMs) =>
      sendOaCommand(
        target.tabId,
        'oa.detectLoginState',
        requestBase(target),
        timeoutMs,
      ),

    // 退出登录会触发页面跳转，响应可能在卸载时丢失；是否真的退出由 waitForLoginPage 判定
    logout: (target, timeoutMs) =>
      sendOaCommand(target.tabId, 'oa.logout', { ...requestBase(target), timeoutMs }, timeoutMs)
        .then(() => undefined)
        .catch((error: unknown) => {
          if (!isContentUnavailable(error)) throw error;
          log.warn('flow-response-lost', { type: 'oa.logout' });
        }),

    waitForLoginPage: (target, timeoutMs) => {
      const deadlineAt = Date.now() + timeoutMs;
      const attempt = () =>
        sendOaCommand(
          target.tabId,
          'oa.waitForLoginPage',
          { ...requestBase(target), timeoutMs },
          Math.max(1, deadlineAt - Date.now()),
          'E_LOGIN_PAGE_TIMEOUT',
        ).then(() => undefined);
      return retryOnContentUnavailable(
        deadlineAt,
        attempt,
        () => new FlowError('E_LOGIN_PAGE_TIMEOUT', { step: 'waitLoginPage' }),
      );
    },

    fillCredentials: (target, timeoutMs) =>
      sendOaCommand(
        target.tabId,
        'oa.fillCredentials',
        { ...requestBase(target), username: target.account.username, password: target.password },
        timeoutMs,
      ).then(() => undefined),

    // 提交会触发导航，响应丢失是预期现象；登录是否成功由 verifyLogin 的证据判定
    submitLogin: (target, timeoutMs) =>
      sendOaCommand(target.tabId, 'oa.submitLogin', requestBase(target), timeoutMs)
        .then(() => undefined)
        .catch((error: unknown) => {
          if (!isContentUnavailable(error)) throw error;
          log.warn('flow-response-lost', { type: 'oa.submitLogin' });
        }),

    verifyLogin: (target, deadlineAt, timeoutMs) =>
      retryOnContentUnavailable(
        deadlineAt,
        () =>
          sendOaCommand(
            target.tabId,
            'oa.verifyLogin',
            { ...requestBase(target), deadlineAt },
            Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now())),
          ),
        () => new FlowError('E_TIMEOUT', { step: 'verify' }),
      ),

    cancel: async (target, timeoutMs) => {
      try {
        await cancelOaRun(target.tabId, requestBase(target), timeoutMs);
      } catch (error) {
        // 取消是尽力而为：页面可能已跳转或已关闭，后台状态仍需落到 cancelled
        log.warn('flow-cancel-cleanup-failed', {
          runId: target.runId,
          reason: isFlowError(error) ? error.code : 'unexpected-error',
        });
      }
    },

    afterTerminal: async () => {
      const settings = await readSettings();
      if (settings.lockAfterSwitch) await vaultService.lock();
    },
  };
}
