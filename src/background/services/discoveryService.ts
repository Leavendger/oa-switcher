import { FlowError } from '../../shared/types/errors';
import type { DiscoveryResult } from '../../shared/types/discovery';
import type { OaVendor } from '../../shared/types/system';
import { deriveDiscoveryFields } from '../discovery/heuristics';
import { collectPageFacts, type PageFacts } from '../discovery/pageFacts';

/** 探测上限：页面加载 15s、脚本注入 8s；任何一步超时都给出明确原因。 */
const LOAD_TIMEOUT_MS = 15_000;
const INJECT_TIMEOUT_MS = 8_000;
const POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => FlowError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
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

function parseTargetUrl(raw: string): { url: string; origin: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new FlowError('E_VALIDATION', { field: 'url', reason: 'invalid' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FlowError('E_VALIDATION', { field: 'url', reason: 'unsupported-protocol' });
  }
  return { url: parsed.toString(), origin: parsed.origin };
}

function isPageFacts(value: unknown): value is PageFacts {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.url === 'string' &&
    Array.isArray(record.forms) &&
    Array.isArray(record.inputs) &&
    Array.isArray(record.buttons)
  );
}

/**
 * 通用自动识别：在后台临时标签页打开目标网址，注入只读探针采集 DOM 结构，
 * 交给通用启发式推导字段，随后立刻关闭标签页。
 *
 * 安全边界：
 * - 不读写任何凭证、cookie、localStorage 或页面正文；
 * - 不点击、不提交、不登录；
 * - 只返回选择器与 URL 规则，调用方负责决定保存哪些字段。
 */
export async function discoverSystem(input: {
  url: string;
  vendor: OaVendor;
}): Promise<DiscoveryResult> {
  const target = parseTargetUrl(input.url);

  const granted = await chrome.permissions.contains({ origins: [`${target.origin}/*`] });
  if (!granted) {
    throw new FlowError('E_NO_PERMISSION', { origin: target.origin, stage: 'discovery' });
  }

  const tab = await chrome.tabs.create({ url: target.url, active: false });
  const tabId = tab.id;
  if (typeof tabId !== 'number') {
    throw new FlowError('E_INTERNAL', { stage: 'discovery-tab' });
  }

  try {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    let finalUrl = target.url;

    for (;;) {
      let current: chrome.tabs.Tab;
      try {
        current = await chrome.tabs.get(tabId);
      } catch {
        throw new FlowError('E_DISCOVERY_FAILED', { reason: 'tab-closed' });
      }

      const url = current.url ?? current.pendingUrl ?? '';
      if (url.startsWith('chrome-error://')) {
        throw new FlowError('E_DISCOVERY_BLOCKED', { reason: 'load-error', url });
      }
      if (current.status === 'complete') {
        finalUrl = url || target.url;
        break;
      }
      if (Date.now() >= deadline) {
        throw new FlowError('E_DISCOVERY_TIMEOUT', {
          reason: 'page-load',
          elapsedMs: LOAD_TIMEOUT_MS,
          url: url || target.url,
        });
      }
      await sleep(POLL_MS);
    }

    // 跨域跳转（例如跳到 SSO 域名）后没有对应权限，明确报被拦截，而不是静默空结果
    let finalOrigin: string | null = null;
    try {
      finalOrigin = new URL(finalUrl).origin;
    } catch {
      finalOrigin = null;
    }
    if (!finalOrigin || finalOrigin !== target.origin) {
      throw new FlowError('E_DISCOVERY_BLOCKED', {
        reason: 'redirected-origin',
        url: finalUrl,
      });
    }

    let facts: PageFacts;
    try {
      const result = await withTimeout(
        chrome.scripting.executeScript({ target: { tabId }, func: collectPageFacts }),
        INJECT_TIMEOUT_MS,
        () => new FlowError('E_DISCOVERY_TIMEOUT', { reason: 'inject', elapsedMs: INJECT_TIMEOUT_MS }),
      );
      const value = result[0]?.result;
      if (!isPageFacts(value)) {
        throw new FlowError('E_DISCOVERY_FAILED', { reason: 'empty-scan' });
      }
      facts = value;
    } catch (error) {
      if (error instanceof FlowError) throw error;
      throw new FlowError('E_DISCOVERY_BLOCKED', {
        reason: 'inject-failed',
        url: finalUrl,
      });
    }

    const derived = deriveDiscoveryFields(facts, input.vendor);
    return {
      ...derived,
      requestedUrl: target.url,
      finalUrl: facts.url || finalUrl,
    };
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}
