import { LIMITS } from '../../shared/constants';
import { log } from '../../shared/log';
import { FlowError } from '../../shared/types/errors';
import { newSystemId, type SystemId } from '../../shared/types/ids';
import type { OASystem, OASystemDraft, OaVendor } from '../../shared/types/system';
import {
  readAccounts,
  readSettings,
  readSystems,
  writeSettings,
  writeSystems,
  writeSystemsAndAccounts,
} from '../../storage/repo';
import { normalizeOrigin, reconcileContentScripts } from '../contentRegistry';
import { clearFloatPrefsForOrigins } from './uiPrefsService';
import { vaultService } from './vaultService';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** URL 签名只做清洗与上限校验；匹配语义由 shared/urlMatch 统一解释。 */
function sanitizeSignatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const output: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > LIMITS.signatureLength) {
      throw new FlowError('E_VALIDATION', { field: 'urlSignatures', reason: 'too-long' });
    }
    if (!output.includes(trimmed)) output.push(trimmed);
  }

  if (output.length > LIMITS.signatureCount) {
    throw new FlowError('E_VALIDATION', { field: 'urlSignatures', reason: 'too-many' });
  }
  return output;
}

/** 新建 / 更新 / 导入共用的系统字段校验，导入不得绕过 origins 与 loginUrl 归属检查。 */
export function validateSystemDraft(draft: OASystemDraft): OASystemDraft {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (name.length === 0 || name.length > LIMITS.systemName) {
    throw new FlowError('E_VALIDATION', { field: 'name' });
  }

  if (draft.vendor !== 'landray' && draft.vendor !== 'other') {
    throw new FlowError('E_VALIDATION', { field: 'vendor' });
  }

  const origins = Array.from(new Set((draft.origins ?? []).map((item) => normalizeOrigin(item) ?? '')));
  const validOrigins = origins.filter((item) => item.length > 0);
  if (validOrigins.length === 0 || validOrigins.length > LIMITS.originCount) {
    throw new FlowError('E_VALIDATION', { field: 'origins' });
  }

  const loginUrl = draft.loginUrl?.trim() ?? '';
  let loginOrigin: string | null = null;
  try {
    loginOrigin = new URL(loginUrl).origin;
  } catch {
    loginOrigin = null;
  }
  if (!loginOrigin || !validOrigins.includes(loginOrigin)) {
    throw new FlowError('E_VALIDATION', { field: 'loginUrl' });
  }

  let homeUrl: string | null = null;
  if (draft.homeUrl) {
    try {
      const parsed = new URL(draft.homeUrl.trim());
      homeUrl = parsed.toString();
    } catch {
      throw new FlowError('E_VALIDATION', { field: 'homeUrl' });
    }
  }

  if (!isRecord(draft.adapterConfig)) {
    throw new FlowError('E_VALIDATION', { field: 'adapterConfig' });
  }

  return {
    name,
    vendor: draft.vendor as OaVendor,
    enabled: draft.enabled !== false,
    origins: validOrigins,
    urlSignatures: sanitizeSignatures(draft.urlSignatures),
    loginUrl,
    homeUrl,
    adapterConfig: draft.adapterConfig,
  };
}

export async function listSystems(): Promise<OASystem[]> {
  return readSystems();
}

export async function createSystem(draft: OASystemDraft): Promise<OASystem> {
  const now = Date.now();
  const systems = await readSystems();
  const normalized = validateSystemDraft(draft);

  if (systems.some((system) => system.name.toLowerCase() === normalized.name.toLowerCase())) {
    throw new FlowError('E_VALIDATION', { field: 'name' });
  }

  const system: OASystem = {
    id: newSystemId(),
    ...normalized,
    urlSignatures: normalized.urlSignatures ?? [],
    permissionState: 'unknown',
    originPermissions: {},
    createdAt: now,
    updatedAt: now,
  };

  await writeSystems([...systems, system]);

  const settings = await readSettings();
  if (!settings.activeSystemId) {
    await writeSettings({ activeSystemId: system.id });
  }

  await reconcileContentScripts();
  return system;
}

export async function updateSystem(id: SystemId, patch: Partial<OASystemDraft>): Promise<OASystem> {
  const systems = await readSystems();
  const current = systems.find((system) => system.id === id);
  if (!current) throw new FlowError('E_VALIDATION', { field: 'id' });

  const merged: OASystemDraft = {
    name: patch.name ?? current.name,
    vendor: patch.vendor ?? current.vendor,
    enabled: patch.enabled ?? current.enabled,
    origins: patch.origins ?? current.origins,
    urlSignatures: patch.urlSignatures ?? current.urlSignatures,
    loginUrl: patch.loginUrl ?? current.loginUrl,
    homeUrl: patch.homeUrl === undefined ? current.homeUrl : patch.homeUrl,
    adapterConfig: patch.adapterConfig ?? current.adapterConfig,
  };
  const normalized = validateSystemDraft(merged);

  const duplicate = systems.some(
    (system) => system.id !== id && system.name.toLowerCase() === normalized.name.toLowerCase(),
  );
  if (duplicate) throw new FlowError('E_VALIDATION', { field: 'name' });

  const updated: OASystem = { ...current, ...normalized, updatedAt: Date.now() };
  await writeSystems(systems.map((system) => (system.id === id ? updated : system)));
  await reconcileContentScripts();
  return updated;
}

export interface DeleteSystemResult {
  deleted: true;
  deletedAccountCount: number;
  /** removed=密文已清理；partial=部分清理；skipped=保险库锁定或无需清理。 */
  credentialCleanup: 'removed' | 'partial' | 'skipped';
  permissionRemoved: boolean;
  /** 非空表示权限可能残留，但不影响系统配置已删除。 */
  permissionWarning: 'permission-may-remain' | null;
  cleanedFloatOrigins: number;
}

/**
 * 删除系统。
 * - 仍有账号引用时默认拒绝（E_SYSTEM_IN_USE），不产生孤儿账号；
 * - `deleteAccounts` 为真时连同这些账号及保险库密文一起清理；
 * - 权限撤销失败不阻塞删除，只返回残留提示。
 */
export async function deleteSystem(
  id: SystemId,
  options: { deleteAccounts?: boolean } = {},
): Promise<DeleteSystemResult> {
  const systems = await readSystems();
  const target = systems.find((system) => system.id === id);
  if (!target) throw new FlowError('E_VALIDATION', { field: 'id' });

  const accounts = await readAccounts();
  const linkedAccounts = accounts.filter((account) => account.systemId === id);
  if (linkedAccounts.length > 0 && !options.deleteAccounts) {
    throw new FlowError('E_SYSTEM_IN_USE', { systemId: id, accountCount: linkedAccounts.length });
  }

  const remainingSystems = systems.filter((system) => system.id !== id);
  const remainingAccounts = accounts.filter((account) => account.systemId !== id);

  // 配置与账号元数据原子写入，避免「系统已删、账号还在」的孤儿状态
  await writeSystemsAndAccounts(remainingSystems, remainingAccounts);

  const settings = await readSettings();
  const rememberedSystems = { ...settings.rememberedSystems };
  let rememberedChanged = false;
  for (const [key, value] of Object.entries(rememberedSystems)) {
    if (value === id) {
      delete rememberedSystems[key];
      rememberedChanged = true;
    }
  }
  if (settings.activeSystemId === id || rememberedChanged) {
    await writeSettings({
      ...(settings.activeSystemId === id ? { activeSystemId: null } : {}),
      ...(rememberedChanged ? { rememberedSystems } : {}),
    });
  }

  // 只有不再被任何剩余系统使用的 origin 才清理悬浮球偏好与域名权限
  const releasedOrigins = target.origins.filter(
    (origin) => !remainingSystems.some((system) => system.origins.includes(origin)),
  );
  const cleanedFloatOrigins = await clearFloatPrefsForOrigins(releasedOrigins);

  let credentialCleanup: DeleteSystemResult['credentialCleanup'] = 'skipped';
  if (linkedAccounts.length > 0) {
    try {
      const { state } = await vaultService.status();
      if (state === 'unlocked') {
        let removed = 0;
        for (const account of linkedAccounts) {
          try {
            await vaultService.removePassword(account.id);
            removed += 1;
          } catch {
            log.warn('system-delete-credential-failed', { accountId: account.id });
          }
        }
        credentialCleanup = removed === linkedAccounts.length ? 'removed' : removed > 0 ? 'partial' : 'skipped';
      }
    } catch {
      credentialCleanup = 'skipped';
    }
  }

  let permissionRemoved = false;
  let permissionWarning: DeleteSystemResult['permissionWarning'] = null;
  if (releasedOrigins.length > 0) {
    try {
      permissionRemoved = await chrome.permissions.remove({
        origins: releasedOrigins.map((origin) => `${origin}/*`),
      });
      if (!permissionRemoved) permissionWarning = 'permission-may-remain';
    } catch {
      permissionWarning = 'permission-may-remain';
    }
  }

  try {
    await reconcileContentScripts();
  } catch {
    log.warn('system-delete-reconcile-failed', { systemId: id });
  }

  return {
    deleted: true,
    deletedAccountCount: linkedAccounts.length,
    credentialCleanup,
    permissionRemoved,
    permissionWarning,
    cleanedFloatOrigins,
  };
}
