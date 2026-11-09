import { withTimeout } from '../../shared/messaging/client';
import { FlowError } from '../../shared/types/errors';
import type { SystemId } from '../../shared/types/ids';
import type { SelfCheckResult } from '../../shared/types/discovery';
import type { OASystem } from '../../shared/types/system';
import { readSystems } from '../../storage/repo';
import { countSelectors, type SelectorCountFact } from '../discovery/pageFacts';
import { buildSelfCheckResult, collectConfiguredSelectors } from '../discovery/selfCheck';

const SELF_CHECK_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPreset(config: Record<string, unknown>): { id: string; version: string } | null {
  const preset = isRecord(config.preset) ? config.preset : null;
  if (!preset) return null;
  const id = text(preset.id);
  const version = text(preset.version);
  if (id.length === 0) return null;
  return { id, version: version.length > 0 ? version : '未知版本' };
}

function tabOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** 找到用户当前打开的、属于该系统的标签页；优先活动标签页。 */
async function findSystemTab(system: OASystem): Promise<{ tabId: number; url: string }> {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter((tab) => {
    if (typeof tab.id !== 'number') return false;
    const origin = tabOrigin(tab.url ?? tab.pendingUrl);
    return origin !== null && system.origins.includes(origin);
  });
  if (candidates.length === 0) {
    throw new FlowError('E_NO_OA_TAB', { systemId: system.id, reason: 'no-tab' });
  }
  const tab = candidates.find((item) => item.active) ?? candidates[candidates.length - 1];
  if (!tab || typeof tab.id !== 'number') {
    throw new FlowError('E_NO_OA_TAB', { systemId: system.id, reason: 'no-tab' });
  }
  return { tabId: tab.id, url: (tab.url ?? tab.pendingUrl ?? '') };
}

/**
 * 只读自检：在用户已打开的该站点标签页上统计各选择器命中数量，并给出登录态判断。
 * 不填写、不点击、不提交、不读取任何输入值。
 */
export async function selfCheckSystem(systemId: SystemId): Promise<SelfCheckResult> {
  const system = (await readSystems()).find((item) => item.id === systemId);
  if (!system) throw new FlowError('E_VALIDATION', { field: 'systemId' });
  if (system.origins.length === 0) {
    throw new FlowError('E_VALIDATION', { field: 'origins' });
  }

  const granted = await chrome.permissions.contains({
    origins: system.origins.map((origin) => `${origin}/*`),
  });
  if (!granted) {
    throw new FlowError('E_NO_PERMISSION', {
      systemId: system.id,
      origin: system.origins[0] ?? '',
      stage: 'self-check',
    });
  }

  const tab = await findSystemTab(system);
  const config = isRecord(system.adapterConfig) ? system.adapterConfig : {};
  const entries = collectConfiguredSelectors(config);

  let counts: SelectorCountFact[] = [];
  if (entries.length > 0) {
    try {
      const injected = await withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: tab.tabId },
          func: countSelectors,
          args: [entries.map((entry) => entry.selector)],
        }),
        SELF_CHECK_TIMEOUT_MS,
        'system.selfCheck',
      );
      const value = injected[0]?.result;
      if (Array.isArray(value)) counts = value as SelectorCountFact[];
    } catch (error) {
      throw new FlowError('E_CONTENT_UNAVAILABLE', {
        reason: 'self-check-failed',
        detail: error instanceof FlowError ? error.code : 'inject-failed',
      });
    }
  }

  return buildSelfCheckResult({
    url: tab.url,
    tabId: tab.tabId,
    fields: entries.map((entry, index) => ({
      key: entry.key,
      selector: entry.selector,
      count: counts[index]?.count ?? null,
      error: counts[index]?.error ?? null,
    })),
    authenticatedUrlPattern: text(config.authenticatedUrlPattern),
    loggedOutUrlPattern: text(config.loggedOutUrlPattern),
    loginPageUrlPattern: text(config.loginPageUrlPattern),
    preset: readPreset(config),
  });
}
