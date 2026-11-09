import { ADAPTER_BUNDLE_VERSION, createAdapter } from '../adapters/registry';
import type { AdapterContext, OaAdapter } from '../adapters/types';
import { log } from '../shared/log';
import {
  createFailure,
  isRecord,
  parseRequest,
  type AnyResponseEnvelope,
} from '../shared/messaging/protocol';
import { dispatchRequest, type RouteTable } from '../shared/messaging/server';
import { serializeError } from '../shared/result';
import { FlowError } from '../shared/types/errors';
import type { OaRequestBase } from '../shared/types/messages';
import { DEFAULT_ADAPTER_TIMEOUTS, type AdapterTimeouts } from '../shared/types/system';
import { frameRole, isRunId } from './guards';
import { createPageDriver } from './pageDriver';

interface ActiveCommand {
  controller: AbortController;
  done: Promise<unknown>;
}

/** 按 runId 记录正在执行的 oa.* 命令，供 oa.cancel 精确中断。 */
const activeCommands = new Map<string, ActiveCommand>();
/** 只保留最近一次取消的 runId：取消后不允许同一 run 再发新命令。 */
let cancelledRunId: string | null = null;

function createOaContext(
  payload: OaRequestBase,
  overrides: Partial<AdapterTimeouts> = {},
): { adapter: OaAdapter; context: AdapterContext; controller: AbortController } {
  const config = payload.adapterConfig ?? {};
  const adapter = createAdapter(payload.vendor, config);
  const controller = new AbortController();
  const context: AdapterContext = {
    driver: createPageDriver(),
    config,
    timeouts: { ...DEFAULT_ADAPTER_TIMEOUTS, ...(payload.timeouts ?? {}), ...overrides },
    signal: controller.signal,
  };
  return { adapter, context, controller };
}

async function runOaCommand<T>(
  payload: OaRequestBase,
  overrides: Partial<AdapterTimeouts>,
  work: (adapter: OaAdapter, context: AdapterContext) => Promise<T>,
): Promise<T> {
  if (payload.runId === cancelledRunId) throw new FlowError('E_CANCELLED');

  const { adapter, context, controller } = createOaContext(payload, overrides);
  const entry: ActiveCommand = {
    controller,
    done: Promise.resolve().then(() => work(adapter, context)),
  };
  activeCommands.set(payload.runId, entry);

  try {
    return (await entry.done) as T;
  } finally {
    if (activeCommands.get(payload.runId) === entry) activeCommands.delete(payload.runId);
  }
}

async function cancelAndCleanup(payload: OaRequestBase): Promise<{ cancelled: true }> {
  cancelledRunId = payload.runId;

  const active = activeCommands.get(payload.runId);
  if (active) {
    active.controller.abort();
    // 等中断真正生效后再清理，避免清理跑在填写前面
    await active.done.catch(() => undefined);
  }

  try {
    const { adapter, context } = createOaContext(payload, {});
    await adapter.clearCredentials?.(context);
  } catch {
    log.warn('content-cancel-cleanup-failed', { runId: payload.runId });
  }

  return { cancelled: true };
}

function contentRoutes(): RouteTable {
  return {
    'content.ping': () =>
      Promise.resolve({
        url: location.href,
        title: document.title,
        ready: true,
        frame: frameRole(),
        adapterVersion: ADAPTER_BUNDLE_VERSION,
      }),
    'oa.detectLoginState': (payload) =>
      runOaCommand(payload, {}, (adapter, context) => adapter.detectLoginState(context)),
    'oa.detectBlockers': (payload) =>
      runOaCommand(payload, {}, (adapter, context) => adapter.detectBlockers(context)),
    'oa.waitForLoginPage': (payload) =>
      runOaCommand(payload, { loginPageWaitMs: payload.timeoutMs }, (adapter, context) =>
        adapter.waitForLoginPage(context).then(() => ({ ready: true as const })),
      ),
    'oa.fillCredentials': (payload) =>
      runOaCommand(payload, {}, (adapter, context) =>
        adapter
          .fillCredentials(context, { username: payload.username, password: payload.password })
          .then(() => ({ filled: true as const })),
      ),
    'oa.submitLogin': (payload) =>
      runOaCommand(payload, {}, (adapter, context) =>
        adapter.submitLogin(context).then(() => ({ submitted: true as const })),
      ),
    'oa.verifyLogin': (payload) =>
      runOaCommand(payload, {}, (adapter, context) =>
        adapter.verifyLogin(context, { deadlineAt: payload.deadlineAt }),
      ),
    'oa.logout': (payload) =>
      runOaCommand(payload, { logoutConfirmMs: payload.timeoutMs }, (adapter, context) =>
        adapter.logout(context).then(() => ({ loggedOut: true as const })),
      ),
    'oa.cancel': (payload) => cancelAndCleanup(payload),
  };
}

/**
 * Content Script 的消息入口：校验信封 → 校验 frame/runId → 路由到配置驱动的适配器。
 */
export async function handleContentRequest(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  topFrame: boolean,
): Promise<AnyResponseEnvelope> {
  const startedAt = Date.now();
  const fallbackId = isRecord(raw) && typeof raw.id === 'string' ? raw.id.slice(0, 64) : 'unknown';

  const parsed = parseRequest(raw);
  if (!parsed.ok) {
    return createFailure(fallbackId, parsed.error, Date.now() - startedAt);
  }

  if (!topFrame) {
    return createFailure(
      parsed.value.id,
      serializeError(new FlowError('E_VALIDATION', { reason: 'not-top-frame' })),
      Date.now() - startedAt,
    );
  }

  const payload = parsed.value.payload as unknown as Record<string, unknown>;
  const runId = payload.runId;
  if (runId !== undefined && !isRunId(runId)) {
    return createFailure(
      parsed.value.id,
      serializeError(new FlowError('E_VALIDATION', { field: 'runId' })),
      Date.now() - startedAt,
    );
  }

  return dispatchRequest(raw, contentRoutes(), { sender });
}
