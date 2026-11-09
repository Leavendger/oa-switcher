import { FLOW_STEP_TIMEOUTS, FLOW_TIMEOUTS } from '../../shared/constants';
import { log } from '../../shared/log';
import { withTimeout } from '../../shared/messaging/client';
import { serializeError } from '../../shared/result';
import { FlowError, isFlowError } from '../../shared/types/errors';
import {
  isTerminalFlowState,
  type FlowEvent,
  type FlowState,
  type FlowStateSnapshot,
  type FlowStepName,
} from '../../shared/types/flow';
import type { RunId } from '../../shared/types/ids';
import { newRunId } from '../../shared/types/ids';
import type { LoginStateReport } from '../../shared/types/messages';
import type { OASystem } from '../../shared/types/system';
import { startKeepalive, stopKeepalive } from '../keepalive';
import { assertTransition } from './machine';
import { snapshotStore } from './snapshotStore';
import {
  createFlowServices,
  type FlowServices,
  type FlowStartInput,
  type FlowTarget,
} from './steps';

export type StartFlowInput = FlowStartInput;

export interface FlowRunnerOptions {
  services?: FlowServices;
  /** 单测可注入短超时；生产使用 FLOW_STEP_TIMEOUTS。 */
  stepTimeouts?: Partial<Record<FlowStepName, number>>;
}

const CANCEL_TIMEOUT_MS = 3_000;

const LOGIN_STATE_SIGNAL_KEYS = [
  'loggedInMarkerSelector',
  'loggedOutMarkerSelector',
  'loginPageUrlPattern',
  'authenticatedUrlPattern',
] as const;

/**
 * unknown 时报出「检查过但没命中的信号」：远程支持时用户只需复述 missing，
 * 就能判断是标记失效、URL 规则不匹配还是两项都没配。
 */
function stateUnknownError(
  system: OASystem,
  evidence: LoginStateReport['evidence'],
): FlowError {
  if (evidence.some((item) => item.kind === 'conflict')) {
    return new FlowError('E_STATE_UNKNOWN', { step: 'probe', reason: 'conflicting-evidence' });
  }
  const config = system.adapterConfig ?? {};
  const checked = LOGIN_STATE_SIGNAL_KEYS.filter((key) => {
    const value = config[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
  return new FlowError('E_STATE_UNKNOWN', {
    step: 'probe',
    reason: 'no-signal-matched',
    ...(checked.length > 0 ? { missing: checked.join(',') } : {}),
  });
}

export class FlowRunner {
  private active: FlowStateSnapshot | null = null;
  private target: FlowTarget | null = null;
  private controller: AbortController | null = null;
  private terminalHookRunId: RunId | null = null;
  private readonly services: FlowServices;
  private readonly stepTimeouts: Record<FlowStepName, number>;

  constructor(options: FlowRunnerOptions = {}) {
    this.services = options.services ?? createFlowServices();
    this.stepTimeouts = { ...FLOW_STEP_TIMEOUTS, ...options.stepTimeouts };
  }

  async restore(): Promise<void> {
    const stored = await snapshotStore.load();
    this.target = null;
    this.controller = null;
    this.terminalHookRunId = null;

    if (!stored) {
      this.active = null;
      return;
    }
    if (isTerminalFlowState(stored.state)) {
      this.active = stored;
      return;
    }

    // 未完成的流程在 SW 重启后不允许续跑：状态不明的半途操作必须由用户重新发起
    const now = Date.now();
    this.active = {
      ...stored,
      state: 'failed',
      step: null,
      updatedAt: now,
      error: serializeError(new FlowError('E_INTERRUPTED', { reason: 'service-worker-restart' })),
    };
    await snapshotStore.set(this.active);
    log.warn('flow-interrupted', { runId: stored.runId, systemId: stored.systemId ?? '' });
  }

  getSnapshot(): FlowStateSnapshot | null {
    return this.active;
  }

  async start(input: StartFlowInput): Promise<{ runId: RunId }> {
    // 同步占位：任何 await 之前完成，保证并发第二次调用立即得到 E_FLOW_BUSY
    if (this.active && !isTerminalFlowState(this.active.state)) {
      throw new FlowError('E_FLOW_BUSY', { accountId: input.accountId });
    }

    const now = Date.now();
    const runId = newRunId();
    this.target = null;
    this.controller = new AbortController();
    this.terminalHookRunId = null;
    this.active = {
      runId,
      state: 'idle',
      accountId: input.accountId,
      systemId: input.systemId ?? null,
      step: null,
      startedAt: now,
      updatedAt: now,
      deadlineAt: now + FLOW_TIMEOUTS.totalMs,
      error: null,
    };

    this.move('START', 'resolve');
    startKeepalive();
    await snapshotStore.set(this.active);

    // 分离执行：Popup 关闭不影响切换，所有进度通过快照端口推送
    void this.execute(runId, input);

    return { runId };
  }

  async cancel(runId: RunId): Promise<{ state: 'cancelled' }> {
    if (!this.active || this.active.runId !== runId) {
      throw new FlowError('E_VALIDATION', { field: 'runId' });
    }
    if (isTerminalFlowState(this.active.state)) {
      throw new FlowError('E_VALIDATION', { field: 'state' });
    }

    this.controller?.abort();
    this.move('CANCEL', null);
    stopKeepalive();
    await snapshotStore.set(this.active);

    const target = this.target;
    if (target) {
      await this.services
        .cancel(target, Math.max(200, Math.min(CANCEL_TIMEOUT_MS, this.remainingMs())))
        .catch((error: unknown) => {
          log.warn('flow-cancel-notify-failed', { runId, reason: detailReason(error) });
        });
    }
    this.runAfterTerminal(runId);

    return { state: 'cancelled' };
  }

  private async execute(runId: RunId, input: StartFlowInput): Promise<void> {
    try {
      const target = await this.runStep(runId, 'resolve', () =>
        this.services.resolve(input, runId),
      );
      if (!this.isRunnable(runId)) return;

      this.target = target;
      this.active = {
        ...this.active!,
        systemId: target.system.id,
        updatedAt: Date.now(),
      };
      if (!(await this.advance(runId, 'RESOLVED', 'probe'))) return;

      const blocker = await this.runStep(runId, 'probe', () =>
        this.services.detectBlockers(target, this.stepTimeouts.probe),
      );
      if (!this.isRunnable(runId)) return;
      if (blocker.blockedBy === 'captcha') {
        await this.fail(runId, 'BLOCKED_CAPTCHA', new FlowError('E_BLOCKED_CAPTCHA', { step: 'probe' }));
        return;
      }
      if (blocker.blockedBy === 'mfa') {
        await this.fail(runId, 'BLOCKED_MFA', new FlowError('E_BLOCKED_MFA', { step: 'probe' }));
        return;
      }

      const login = await this.runStep(runId, 'probe', () =>
        this.services.detectLoginState(target, this.stepTimeouts.probe),
      );
      if (!this.isRunnable(runId)) return;

      if (login.state === 'unknown') {
        await this.fail(runId, 'STATE_UNKNOWN', stateUnknownError(target.system, login.evidence));
        return;
      }

      if (login.state === 'loggedIn') {
        if (!(await this.advance(runId, 'STATE_LOGGED_IN', 'logout'))) return;
        await this.runStep(runId, 'logout', () =>
          this.services.logout(target, this.stepTimeouts.logout),
        );
        if (!this.isRunnable(runId)) return;
        if (!(await this.advance(runId, 'LOGGED_OUT', 'waitLoginPage'))) return;
      } else {
        if (!(await this.advance(runId, 'STATE_LOGGED_OUT', 'waitLoginPage'))) return;
      }

      await this.runStep(
        runId,
        'waitLoginPage',
        () => this.services.waitForLoginPage(target, this.stepTimeouts.waitLoginPage),
        'E_LOGIN_PAGE_TIMEOUT',
      );
      if (!this.isRunnable(runId)) return;
      if (!(await this.advance(runId, 'PAGE_READY', 'fill'))) return;

      await this.runStep(runId, 'fill', () =>
        this.services.fillCredentials(target, this.stepTimeouts.fill),
      );
      if (!this.isRunnable(runId)) return;
      // 密码已填入页面，后续步骤不再需要：立即从内存目标中清除
      if (this.target) this.target.password = '';
      if (!(await this.advance(runId, 'FILLED', 'submit'))) return;

      await this.runStep(runId, 'submit', () =>
        this.services.submitLogin(target, this.stepTimeouts.submit),
      );
      if (!this.isRunnable(runId)) return;
      if (!(await this.advance(runId, 'SUBMITTED', 'verify'))) return;

      const verification = await this.verify(target, runId);
      if (!this.isRunnable(runId)) return;

      if (verification.outcome === 'success') {
        this.move('VERIFIED_SUCCESS', null);
        this.active = { ...this.active!, error: null, updatedAt: Date.now() };
        stopKeepalive();
        await snapshotStore.set(this.active);
        return;
      }
      if (verification.outcome === 'failure') {
        await this.fail(
          runId,
          'VERIFIED_FAILURE',
          new FlowError('E_LOGIN_REJECTED', { step: 'verify' }),
        );
        return;
      }
      // 没有成功证据一律失败，绝不把 unknown 当作成功
      await this.fail(runId, 'ERROR', new FlowError('E_VERIFY_TIMEOUT', { step: 'verify' }));
    } catch (error) {
      await this.handleError(runId, error);
    } finally {
      if (this.active?.runId === runId && isTerminalFlowState(this.active.state)) {
        stopKeepalive();
        this.runAfterTerminal(runId);
      }
    }
  }

  /** 终态钩子只执行一次；失败只记日志，不改变流程结论。 */
  private runAfterTerminal(runId: RunId): void {
    if (this.terminalHookRunId === runId) return;
    this.terminalHookRunId = runId;
    void this.services.afterTerminal?.().catch((error: unknown) => {
      log.warn('flow-terminal-hook-failed', { runId, reason: detailReason(error) });
    });
  }

  private async verify(
    target: FlowTarget,
    runId: RunId,
  ): Promise<{ outcome: 'success' | 'failure' | 'unknown' }> {
    const deadlineAt = Math.min(
      this.active?.deadlineAt ?? Number.MAX_SAFE_INTEGER,
      Date.now() + this.stepTimeouts.verify,
    );
    try {
      const result = await this.runStep(runId, 'verify', () =>
        this.services.verifyLogin(target, deadlineAt, this.stepTimeouts.verify),
      );
      return { outcome: result.outcome };
    } catch (error) {
      if (isFlowError(error) && error.code === 'E_TIMEOUT') {
        throw new FlowError('E_VERIFY_TIMEOUT', { step: 'verify' });
      }
      throw error;
    }
  }

  private async runStep<T>(
    runId: RunId,
    step: FlowStepName,
    work: () => Promise<T>,
    code: 'E_TIMEOUT' | 'E_LOGIN_PAGE_TIMEOUT' = 'E_TIMEOUT',
  ): Promise<T> {
    if (!this.isRunnable(runId)) throw new FlowError('E_CANCELLED');

    const remaining = this.remainingMs();
    if (remaining <= 0) throw new FlowError('E_TIMEOUT', { step, reason: 'flow-deadline' });

    const limit = Math.min(this.stepTimeouts[step], remaining);
    return withTimeout(work(), limit, step, code);
  }

  private remainingMs(): number {
    const deadlineAt = this.active?.deadlineAt;
    if (deadlineAt === null || deadlineAt === undefined) return Number.MAX_SAFE_INTEGER;
    return deadlineAt - Date.now();
  }

  private isRunnable(runId: RunId): boolean {
    return (
      this.active?.runId === runId &&
      !isTerminalFlowState(this.active.state) &&
      this.controller?.signal.aborted !== true
    );
  }

  /** 迁移 + 立即落快照；返回 false 表示流程已在迁移间隙被取消/失败。 */
  private async advance(
    runId: RunId,
    event: FlowEvent,
    step: FlowStepName,
  ): Promise<boolean> {
    if (!this.isRunnable(runId)) return false;
    this.move(event, step);
    await snapshotStore.set(this.active);
    return this.isRunnable(runId);
  }

  private async fail(runId: RunId, event: FlowEvent, error: unknown): Promise<void> {
    if (!this.isRunnable(runId)) return;
    this.move(event, null);
    this.active = {
      ...this.active!,
      error: serializeError(error),
      updatedAt: Date.now(),
    };
    stopKeepalive();
    await snapshotStore.set(this.active);
    log.warn('flow-failed', { runId, reason: detailReason(error) });
  }

  private async handleError(runId: RunId, error: unknown): Promise<void> {
    if (!this.isRunnable(runId)) return;

    if (isFlowError(error) && error.code === 'E_CANCELLED') {
      this.move('CANCEL', null);
      stopKeepalive();
      await snapshotStore.set(this.active);
      return;
    }

    this.move('ERROR', null);
    this.active = {
      ...this.active!,
      error: serializeError(error),
      updatedAt: Date.now(),
    };
    stopKeepalive();
    await snapshotStore.set(this.active);
    log.warn('flow-failed', { runId, reason: detailReason(error) });
  }

  private move(event: FlowEvent, step: FlowStepName | null): void {
    if (!this.active) throw new FlowError('E_INTERNAL', { reason: 'no-active-run' });
    const next: FlowState = assertTransition(this.active.state, event);
    this.active = {
      ...this.active,
      state: next,
      step,
      updatedAt: Date.now(),
      error: next === 'failed' ? this.active.error : null,
    };
  }
}

function detailReason(error: unknown): string {
  return isFlowError(error) ? error.code : 'unexpected-error';
}

export const flowRunner = new FlowRunner();
