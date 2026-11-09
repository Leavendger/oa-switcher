import { PORT_NAME, PORT_RECONNECT_DELAY_MS } from '../constants';
import { FlowError, isFlowError } from '../types/errors';
import type { FlowStateSnapshot } from '../types/flow';
import type { RequestPayloadMap, RequestType, ResponseDataMap } from '../types/messages';
import type { VaultState } from '../types/settings';
import { createRequest, isFlowStateEvent, isResponseEnvelope, isVaultStateEvent } from './protocol';

export const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  step: string,
  code: 'E_TIMEOUT' | 'E_LOGIN_PAGE_TIMEOUT' = 'E_TIMEOUT',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new FlowError(code, { step, elapsedMs: timeoutMs }));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** UI → Background 的类型安全调用。失败统一以 FlowError 抛出。 */
export async function callBackground<K extends RequestType>(
  type: K,
  payload: RequestPayloadMap[K],
  options: { timeoutMs?: number } = {},
): Promise<ResponseDataMap[K]> {
  const envelope = createRequest(type, payload);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  let raw: unknown;
  try {
    raw = await withTimeout<unknown>(chrome.runtime.sendMessage(envelope), timeoutMs, type);
  } catch (error) {
    if (isFlowError(error)) throw error;
    throw new FlowError('E_INTERNAL', { stage: 'sendMessage', type });
  }

  if (!isResponseEnvelope(raw) || raw.id !== envelope.id) {
    throw new FlowError('E_INTERNAL', { stage: 'invalid-response', type });
  }
  if (!raw.ok) {
    throw new FlowError(raw.error.code, raw.error.detail);
  }
  return raw.data as ResponseDataMap[K];
}

export interface UiPortHandlers {
  /** 流程快照推送。 */
  onSnapshot?: (snapshot: FlowStateSnapshot) => void;
  /** 保险库状态广播：收到后应重新拉取权威状态。 */
  onVaultState?: (state: VaultState) => void;
  /** 端口断开（通常是 SW 被回收）：UI 应重拉状态，客户端会自动重连。 */
  onReconnect?: () => void;
}

/**
 * Popup / 悬浮球订阅后台事件。返回取消订阅函数。
 * SW 被回收会断开端口：这里自动重连，并先回调 onReconnect 让 UI 重新拉权威状态，
 * 避免继续显示「已解锁」这类陈旧状态。
 */
export function connectFlowPort(handlers: UiPortHandlers): () => void {
  let closed = false;
  let port: chrome.runtime.Port | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const open = (): void => {
    const current = chrome.runtime.connect({ name: PORT_NAME });
    port = current;
    current.onMessage.addListener((message: unknown) => {
      if (isFlowStateEvent(message)) handlers.onSnapshot?.(message.snapshot);
      else if (isVaultStateEvent(message)) handlers.onVaultState?.(message.state);
    });
    current.onDisconnect.addListener(() => {
      if (closed) return;
      handlers.onReconnect?.();
      retry = setTimeout(() => {
        retry = null;
        if (closed) return;
        open();
        handlers.onReconnect?.();
      }, PORT_RECONNECT_DELAY_MS);
    });
  };

  open();

  return () => {
    closed = true;
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
    try {
      port?.disconnect();
    } catch {
      // 端口可能已被后台或页面销毁
    }
    port = null;
  };
}
