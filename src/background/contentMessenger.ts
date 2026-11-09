import { FLOW_TIMEOUTS } from '../shared/constants';
import { withTimeout } from '../shared/messaging/client';
import { createRequest, isResponseEnvelope } from '../shared/messaging/protocol';
import { matchUrlToSystems, systemSignatures } from '../shared/systemMatch';
import { matchesUrlPattern } from '../shared/urlMatch';
import { FlowError, isFlowError } from '../shared/types/errors';
import type { ContentPingData } from '../shared/types/flow';
import type { RequestPayloadMap, RequestType, ResponseDataMap } from '../shared/types/messages';
import type { SystemId } from '../shared/types/ids';
import type { OASystem } from '../shared/types/system';
import { readSystems } from '../storage/repo';

/** 发送一次类型安全的 Tab 消息，并把底层异常统一成错误码。 */
async function sendTabRequest<K extends RequestType>(
  tabId: number,
  type: K,
  payload: RequestPayloadMap[K],
  timeoutMs: number,
  timeoutCode: 'E_TIMEOUT' | 'E_LOGIN_PAGE_TIMEOUT' = 'E_TIMEOUT',
): Promise<ResponseDataMap[K]> {
  const envelope = createRequest(type, payload);

  let raw: unknown;
  try {
    raw = await withTimeout<unknown>(
      chrome.tabs.sendMessage(tabId, envelope),
      timeoutMs,
      type,
      timeoutCode,
    );
  } catch (error) {
    if (isFlowError(error)) throw error;
    throw new FlowError('E_CONTENT_UNAVAILABLE', { reason: 'send-failed', type });
  }

  if (!isResponseEnvelope(raw) || raw.id !== envelope.id) {
    throw new FlowError('E_CONTENT_UNAVAILABLE', { reason: 'invalid-response', type });
  }
  if (!raw.ok) {
    throw new FlowError(raw.error.code, raw.error.detail);
  }
  return raw.data as ResponseDataMap[K];
}

async function pingTab(tabId: number): Promise<ContentPingData> {
  return sendTabRequest(tabId, 'content.ping', {}, FLOW_TIMEOUTS.contentPingMs);
}

/** 页面导航后 Content Script 可能尚未就绪：失败则补注入并重试一次。 */
export async function ensureContentReady(tabId: number): Promise<ContentPingData> {
  try {
    return await pingTab(tabId);
  } catch (error) {
    if (isFlowError(error) && error.code !== 'E_CONTENT_UNAVAILABLE') throw error;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    throw new FlowError('E_CONTENT_UNAVAILABLE', { reason: 'inject-failed' });
  }
  return pingTab(tabId);
}

function tabOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** 定位当前活动标签页并确认它属于目标系统；返回可用于后续 oa.* 命令的 tabId。 */
export async function resolveOaTab(system: OASystem): Promise<number> {
  const granted = await chrome.permissions.contains({
    origins: system.origins.map((origin) => `${origin}/*`),
  });
  if (!granted) {
    throw new FlowError('E_NO_PERMISSION', {
      systemId: system.id,
      origin: system.origins[0] ?? '',
    });
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== 'number') {
    throw new FlowError('E_NO_OA_TAB', { reason: 'no-active-tab' });
  }
  if (!tab.url) {
    throw new FlowError('E_NO_PERMISSION', { reason: 'tab-url-unavailable' });
  }

  const origin = tabOrigin(tab.url);
  if (!origin || !system.origins.includes(origin)) {
    throw new FlowError('E_NO_OA_TAB', { reason: 'origin-mismatch', origin: origin ?? '' });
  }

  // 同 origin 多系统时 origin 不足以证明归属，必须再校验当前 URL 命中目标系统签名
  const systems = await readSystems();
  const sharingOrigin = systems.filter(
    (item) => item.enabled && item.origins.includes(origin) && item.id !== system.id,
  );
  if (sharingOrigin.length > 0) {
    const owned = systemSignatures(system).some((signature) => matchesUrlPattern(signature, tab.url!));
    if (!owned) {
      throw new FlowError('E_NO_OA_TAB', {
        reason: 'signature-mismatch',
        origin,
        systemId: system.id,
      });
    }
  }

  await ensureContentReady(tab.id);
  return tab.id;
}

/** 探测当前活动标签页上的 OA 页面。确定性流程：先直接 ping，失败则补齐注入后重试一次。 */
export async function pingActiveTab(systemId?: SystemId): Promise<ContentPingData> {
  const systems = await readSystems();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== 'number') {
    throw new FlowError('E_NO_OA_TAB', { reason: 'no-active-tab' });
  }
  if (!tab.url) {
    throw new FlowError('E_NO_PERMISSION', { reason: 'tab-url-unavailable' });
  }

  const origin = tabOrigin(tab.url);
  if (systemId) {
    const target = systems.find((system) => system.id === systemId);
    if (target && origin && !target.origins.includes(origin)) {
      throw new FlowError('E_NO_OA_TAB', { reason: 'origin-mismatch', origin });
    }
  } else {
    // 未指定系统时按当前 URL 识别，避免默认取 systems[0] 造成误判
    const resolution = matchUrlToSystems(tab.url, systems, {});
    if (resolution.status === 'none') {
      throw new FlowError('E_NO_OA_TAB', { reason: 'origin-mismatch', origin: origin ?? '' });
    }
  }

  return ensureContentReady(tab.id);
}

/** 所有 oa.* 命令都先确认 Content 就绪，避免导航过程中丢消息。 */
export async function sendOaCommand<
  K extends
    | 'oa.detectLoginState'
    | 'oa.detectBlockers'
    | 'oa.waitForLoginPage'
    | 'oa.fillCredentials'
    | 'oa.submitLogin'
    | 'oa.verifyLogin'
    | 'oa.logout',
>(
  tabId: number,
  type: K,
  payload: RequestPayloadMap[K],
  timeoutMs: number,
  timeoutCode: 'E_TIMEOUT' | 'E_LOGIN_PAGE_TIMEOUT' = 'E_TIMEOUT',
): Promise<ResponseDataMap[K]> {
  await ensureContentReady(tabId);
  return sendTabRequest(tabId, type, payload, timeoutMs, timeoutCode);
}

/** 取消并清理：Content 不可用时由调用方决定是否记录告警。 */
export async function cancelOaRun(
  tabId: number,
  payload: RequestPayloadMap['oa.cancel'],
  timeoutMs: number = FLOW_TIMEOUTS.contentPingMs,
): Promise<void> {
  try {
    await ensureContentReady(tabId);
  } catch {
    // 页面可能正在导航，仍尝试直接发送取消消息
  }
  await sendTabRequest(tabId, 'oa.cancel', payload, timeoutMs);
}
