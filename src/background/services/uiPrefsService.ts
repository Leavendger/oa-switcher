import { STORAGE_KEYS } from '../../storage/keys';
import type { FloatPoint, FloatPrefs } from '../../shared/types/ui';

/** 悬浮球的页面侧偏好：全局开关、站点级关闭、位置记忆。 */

function readDismissed(raw: unknown): Record<string, true> {
  if (typeof raw !== 'object' || raw === null) return {};
  const output: Record<string, true> = {};
  for (const [origin, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true) output[origin] = true;
  }
  return output;
}

function readPositions(raw: unknown): Record<string, FloatPoint> {
  if (typeof raw !== 'object' || raw === null) return {};
  const output: Record<string, FloatPoint> = {};
  for (const [origin, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const point = value as { x?: unknown; y?: unknown };
    if (typeof point.x === 'number' && typeof point.y === 'number') {
      output[origin] = { x: point.x, y: point.y };
    }
  }
  return output;
}

/** 只接受 http(s) origin，避免把任意字符串写成存储键。 */
export function normalizeFloatOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function readFloatPrefs(): Promise<FloatPrefs> {
  const stored = (await chrome.storage.local.get([
    STORAGE_KEYS.floatEnabled,
    STORAGE_KEYS.floatDismissed,
    STORAGE_KEYS.floatPositions,
  ])) as Record<string, unknown>;

  return {
    enabled: stored[STORAGE_KEYS.floatEnabled] !== false,
    dismissed: readDismissed(stored[STORAGE_KEYS.floatDismissed]),
    positions: readPositions(stored[STORAGE_KEYS.floatPositions]),
  };
}

export async function dismissFloatSite(origin: string): Promise<void> {
  const stored = (await chrome.storage.local.get([STORAGE_KEYS.floatDismissed])) as Record<
    string,
    unknown
  >;
  const next = { ...readDismissed(stored[STORAGE_KEYS.floatDismissed]), [origin]: true as const };
  await chrome.storage.local.set({ [STORAGE_KEYS.floatDismissed]: next });
}

export async function saveFloatPosition(origin: string, point: FloatPoint): Promise<void> {
  const stored = (await chrome.storage.local.get([STORAGE_KEYS.floatPositions])) as Record<
    string,
    unknown
  >;
  const next = {
    ...readPositions(stored[STORAGE_KEYS.floatPositions]),
    [origin]: { x: point.x, y: point.y },
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.floatPositions]: next });
}

/** 删除系统时清理其独占 origin 的悬浮球偏好，返回清理的条目数。 */
export async function clearFloatPrefsForOrigins(origins: string[]): Promise<number> {
  if (origins.length === 0) return 0;
  const stored = (await chrome.storage.local.get([
    STORAGE_KEYS.floatDismissed,
    STORAGE_KEYS.floatPositions,
  ])) as Record<string, unknown>;

  const dismissed = readDismissed(stored[STORAGE_KEYS.floatDismissed]);
  const positions = readPositions(stored[STORAGE_KEYS.floatPositions]);
  let removed = 0;
  for (const origin of origins) {
    if (origin in dismissed) {
      delete dismissed[origin];
      removed += 1;
    }
    if (origin in positions) {
      delete positions[origin];
      removed += 1;
    }
  }
  if (removed === 0) return 0;

  await chrome.storage.local.set({
    [STORAGE_KEYS.floatDismissed]: dismissed,
    [STORAGE_KEYS.floatPositions]: positions,
  });
  return removed;
}
