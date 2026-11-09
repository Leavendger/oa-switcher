import { log } from '../shared/log';
import type { OASystem, PermissionState } from '../shared/types/system';
import { readSystems, writeSystems } from '../storage/repo';

const SCRIPT_ID_PREFIX = 'oa-switcher:';

/** 校验用户配置的 origin：仅允许 http(s) + 主机（+可选端口），不含路径/查询/hash。 */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function matchesForSystem(system: OASystem): string[] {
  return system.origins
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null)
    .map((origin) => `${origin}/*`);
}

/** 注册 id 必须稳定且唯一：同 origin 只有一个脚本，origin 文本加短哈希避免转义后撞名。 */
function scriptIdForOrigin(origin: string): string {
  let hash = 5381;
  for (let index = 0; index < origin.length; index += 1) {
    hash = ((hash << 5) + hash + origin.charCodeAt(index)) >>> 0;
  }
  const readable = origin.replace(/[^a-zA-Z0-9]/g, '_');
  return `${SCRIPT_ID_PREFIX}${readable}_${hash.toString(36)}`;
}

/**
 * 多个触发源（permissions.onAdded、permission.ensure、SW 初始化）可能并发；
 * 串行执行可避免「注销 / 注册」交错：并发时后一次 register 会命中
 * Duplicate script ID，被 catch 误判为未授权并写回 denied。
 */
let reconcileQueue: Promise<void> = Promise.resolve();

/** 依据已配置的系统重建动态 Content Script 注册。未配置系统时全部注销。 */
export async function reconcileContentScripts(): Promise<void> {
  const next = reconcileQueue.then(runReconcile, runReconcile);
  // 队列自身永远不保留拒绝状态，避免一次失败卡死后续触发
  reconcileQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function derivePermissionState(states: PermissionState[]): PermissionState {
  if (states.length === 0) return 'unknown';
  if (states.every((state) => state === 'granted')) return 'granted';
  if (states.every((state) => state === 'denied')) return 'denied';
  return 'unknown';
}

function sameRecord(
  left: Record<string, PermissionState> | undefined,
  right: Record<string, PermissionState>,
): boolean {
  const keys = Object.keys(right);
  if ((left ? Object.keys(left).length : 0) !== keys.length) return false;
  return keys.every((key) => left?.[key] === right[key]);
}

async function runReconcile(): Promise<void> {
  const systems = await readSystems();

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ours = registered.map((item) => item.id).filter((id) => id.startsWith(SCRIPT_ID_PREFIX));
  if (ours.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: ours });
  }

  const enabledSystems = systems.filter((system) => system.enabled);

  // 同域多系统只注册一次：按 origin 聚合，避免相同 matches 的脚本重复注入
  const systemsByOrigin = new Map<string, OASystem[]>();
  for (const system of enabledSystems) {
    for (const origin of system.origins) {
      const normalized = normalizeOrigin(origin);
      if (!normalized) continue;
      const list = systemsByOrigin.get(normalized) ?? [];
      list.push(system);
      systemsByOrigin.set(normalized, list);
    }
  }

  const originState = new Map<string, PermissionState>();
  for (const origin of systemsByOrigin.keys()) {
    const patterns = [`${origin}/*`];

    // 授权结果必须以 permissions.contains 为准，注册成功不代表能注入
    let granted = false;
    try {
      granted = await chrome.permissions.contains({ origins: patterns });
    } catch {
      log.warn('content-script-permission-check-failed', { origin });
    }

    if (!granted) {
      originState.set(origin, 'denied');
      continue;
    }

    try {
      await chrome.scripting.registerContentScripts([
        {
          id: scriptIdForOrigin(origin),
          matches: patterns,
          js: ['content.js'],
          runAt: 'document_idle',
          allFrames: false,
          persistAcrossSessions: true,
        },
      ]);
      originState.set(origin, 'granted');
    } catch {
      log.warn('content-script-register-failed', { origin });
      originState.set(origin, 'denied');
    }
  }

  // 系统级权限状态由 origin 派生，避免同域多系统互相覆盖
  let changed = false;
  const nextSystems = systems.map((system) => {
    if (!system.enabled) return system;

    const originPermissions: Record<string, PermissionState> = {};
    for (const origin of system.origins) {
      const normalized = normalizeOrigin(origin);
      if (!normalized) continue;
      originPermissions[normalized] = originState.get(normalized) ?? 'denied';
    }
    const permissionState = derivePermissionState(Object.values(originPermissions));

    if (system.permissionState === permissionState && sameRecord(system.originPermissions, originPermissions)) {
      return system;
    }
    changed = true;
    return { ...system, permissionState, originPermissions, updatedAt: Date.now() };
  });

  if (changed) await writeSystems(nextSystems);

  log.info('content-scripts-reconciled', {
    origins: systemsByOrigin.size,
    systems: enabledSystems.length,
  });
}
