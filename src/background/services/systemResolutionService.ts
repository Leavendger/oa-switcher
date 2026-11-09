import { matchUrlToSystems } from '../../shared/systemMatch';
import { FlowError } from '../../shared/types/errors';
import type { SystemId } from '../../shared/types/ids';
import type { ActiveTabResolution } from '../../shared/types/system';
import { readSettings, readSystems } from '../../storage/repo';

/**
 * 取「最后聚焦窗口」的活动页：Popup / Options 本身也是窗口，
 * 用 lastFocusedWindow 才能拿到用户真正在看的那个标签页。
 */
async function readActiveTab(): Promise<{ tabId: number | null; url: string | null }> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== 'number') return { tabId: null, url: null };
    return { tabId: tab.id, url: tab.url ?? tab.pendingUrl ?? null };
  } catch {
    return { tabId: null, url: null };
  }
}

/** Popup 首屏解析当前活动页归属：歧义只返回候选，不抛错，由 UI 让用户选择。 */
export async function resolveActiveTab(): Promise<ActiveTabResolution> {
  const [tab, systems, settings] = await Promise.all([
    readActiveTab(),
    readSystems(),
    readSettings(),
  ]);

  return {
    ...matchUrlToSystems(tab.url, systems, settings.rememberedSystems),
    tabId: tab.tabId,
  };
}

/** 供页面内悬浮球按自身 URL 解析归属（不依赖「活动标签页」的判断）。 */
export async function resolveUrl(url: string): Promise<ActiveTabResolution> {
  const [systems, settings] = await Promise.all([readSystems(), readSettings()]);
  return matchUrlToSystems(url, systems, settings.rememberedSystems);
}

/** 「切到 OA 标签页」：优先激活已有标签页，没有则按登录页新建。 */
export async function openOaTab(systemId?: SystemId): Promise<{ tabId: number; created: boolean }> {
  const [systems, settings] = await Promise.all([readSystems(), readSettings()]);

  const target = systemId
    ? systems.find((system) => system.id === systemId)
    : (systems.find((system) => system.id === settings.activeSystemId && system.enabled) ??
      systems.find((system) => system.enabled));

  if (!target) throw new FlowError('E_VALIDATION', { field: 'systemId', reason: 'missing' });
  if (target.origins.length === 0) {
    throw new FlowError('E_VALIDATION', { field: 'origins', reason: 'empty' });
  }

  const existing = (await chrome.tabs.query({})).find((tab) => {
    if (!tab.url) return false;
    try {
      return target.origins.includes(new URL(tab.url).origin);
    } catch {
      return false;
    }
  });

  if (existing && typeof existing.id === 'number') {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === 'number') {
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => undefined);
    }
    return { tabId: existing.id, created: false };
  }

  const created = await chrome.tabs.create({ url: target.loginUrl, active: true });
  if (typeof created.id !== 'number') {
    throw new FlowError('E_INTERNAL', { stage: 'open-oa-tab' });
  }
  return { tabId: created.id, created: true };
}
