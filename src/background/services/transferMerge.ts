import { GROUP_COLOR_KEYS, LIMITS } from '../../shared/constants';
import type { Account, AccountGroup } from '../../shared/types/account';
import { FlowError } from '../../shared/types/errors';
import {
  newAccountId,
  newGroupId,
  newSystemId,
  type AccountId,
  type GroupId,
  type SystemId,
} from '../../shared/types/ids';
import { normalizeSettings, normalizeSystem } from '../../storage/repo';
import type { OASystem } from '../../shared/types/system';
import type {
  TransferConflictMode,
  TransferCountSummary,
  TransferFile,
  TransferRenamePreview,
} from '../../shared/types/transfer';
import type { FloatPrefs, FloatPoint } from '../../shared/types/ui';
import { validateSystemDraft } from './systemService';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(section: string, reason: string): FlowError {
  return new FlowError('E_TRANSFER_INVALID', { field: section, reason });
}

function requireString(value: unknown, max: number, section: string): string {
  if (typeof value !== 'string') throw fail(section, 'invalid-type');
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) throw fail(section, 'invalid-length');
  return trimmed;
}

function optionalString(value: unknown, max: number, section: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw fail(section, 'invalid-type');
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw fail(section, 'invalid-length');
  return trimmed;
}

function finiteTime(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function assertUniqueIds(items: { id: string }[], section: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw fail(section, 'duplicate-id');
    seen.add(item.id);
  }
}

function withSuffix(value: string, max: number): string {
  const suffix = '（导入）';
  return `${value.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

/** 名称冲突时追加「（导入）」并保证长度上限，返回值一定能用于存储。 */
function uniqueName(
  desired: string,
  used: Set<string>,
  max: number,
  forceSuffix: boolean,
): string {
  const initial = forceSuffix ? withSuffix(desired, max) : desired.slice(0, max);
  if (!used.has(initial.toLowerCase())) {
    used.add(initial.toLowerCase());
    return initial;
  }

  let counter = 2;
  while (true) {
    const suffix = `（导入${counter}）`;
    const base = `${desired.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
    if (!used.has(base.toLowerCase())) {
      used.add(base.toLowerCase());
      return base;
    }
    counter += 1;
  }
}

function readDismissed(raw: unknown): Record<string, true> {
  if (!isRecord(raw)) return {};
  const output: Record<string, true> = {};
  for (const [origin, value] of Object.entries(raw)) {
    if (value === true) output[origin] = true;
  }
  return output;
}

function readPositions(raw: unknown): Record<string, FloatPoint> {
  if (!isRecord(raw)) return {};
  const output: Record<string, FloatPoint> = {};
  for (const [origin, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    if (typeof value.x === 'number' && typeof value.y === 'number') {
      output[origin] = { x: value.x, y: value.y };
    }
  }
  return output;
}

function parseSystem(raw: unknown): OASystem {
  const normalized = normalizeSystem(raw);
  if (!normalized) throw fail('systems', 'invalid-record');

  const draft = validateSystemDraft({
    name: normalized.name,
    vendor: normalized.vendor,
    enabled: normalized.enabled,
    origins: normalized.origins,
    urlSignatures: normalized.urlSignatures,
    loginUrl: normalized.loginUrl,
    homeUrl: normalized.homeUrl,
    adapterConfig: normalized.adapterConfig,
  });
  const now = Date.now();
  return {
    id: normalized.id,
    ...draft,
    urlSignatures: draft.urlSignatures ?? [],
    permissionState: normalized.permissionState,
    originPermissions: normalized.originPermissions,
    createdAt: finiteTime(normalized.createdAt, now),
    updatedAt: finiteTime(normalized.updatedAt, now),
  };
}

function parseGroup(raw: unknown): AccountGroup {
  if (!isRecord(raw)) throw fail('groups', 'invalid-record');
  const id = requireString(raw.id, 64, 'groups');
  const name = requireString(raw.name, LIMITS.groupName, 'groups');

  let color: string | null = null;
  if (raw.color !== null && raw.color !== undefined) {
    if (typeof raw.color !== 'string') throw fail('groups', 'invalid-color');
    if (!(GROUP_COLOR_KEYS as readonly string[]).includes(raw.color)) {
      throw fail('groups', 'invalid-color');
    }
    color = raw.color;
  }
  if (!Number.isInteger(raw.sortOrder)) throw fail('groups', 'invalid-sort-order');
  if (typeof raw.collapsedByDefault !== 'boolean') {
    throw fail('groups', 'invalid-collapsed');
  }

  const now = Date.now();
  return {
    id: id as GroupId,
    name,
    color,
    sortOrder: raw.sortOrder as number,
    collapsedByDefault: raw.collapsedByDefault,
    createdAt: finiteTime(raw.createdAt, now),
    updatedAt: finiteTime(raw.updatedAt, now),
  };
}

function parseAccount(raw: unknown): Account {
  if (!isRecord(raw)) throw fail('accounts', 'invalid-record');
  const id = requireString(raw.id, 64, 'accounts');
  const label = requireString(raw.label, LIMITS.accountLabel, 'accounts');
  const username = requireString(raw.username, LIMITS.username, 'accounts');
  const systemId = requireString(raw.systemId, 64, 'accounts');
  const groupId = optionalString(raw.groupId, 64, 'accounts');
  const role = optionalString(raw.role, LIMITS.accountRole, 'accounts');
  const note = optionalString(raw.note, LIMITS.accountNote, 'accounts');
  if (typeof raw.enabled !== 'boolean') throw fail('accounts', 'invalid-enabled');
  if (!Number.isInteger(raw.sortOrder)) throw fail('accounts', 'invalid-sort-order');

  const now = Date.now();
  return {
    id: id as AccountId,
    label,
    username,
    systemId: systemId as SystemId,
    groupId: groupId as GroupId | null,
    role,
    note,
    enabled: raw.enabled,
    sortOrder: raw.sortOrder as number,
    createdAt: finiteTime(raw.createdAt, now),
    updatedAt: finiteTime(raw.updatedAt, now),
  };
}

export interface TransferLocalState {
  systems: OASystem[];
  accounts: Account[];
  groups: AccountGroup[];
  /** 原始 settings 值：用于判断「本机是否真的写过某个偏好」。 */
  settingsRaw: unknown;
  floatRaw: { enabled: unknown; dismissed: unknown; positions: unknown };
}

export interface TransferMergePlan {
  systems: OASystem[];
  accounts: Account[];
  groups: AccountGroup[];
  settings: ReturnType<typeof normalizeSettings>;
  float: FloatPrefs;
  /** 保留双方时导入 ID → 新 ID；保险库条目按此映射。 */
  systemIdMap: Record<string, string>;
  groupIdMap: Record<string, string>;
  accountIdMap: Record<string, string>;
  renames: TransferRenamePreview[];
  added: TransferCountSummary;
  overwritten: TransferCountSummary;
  keptBoth: TransferCountSummary;
}

const SETTINGS_PREFERENCE_KEYS = [
  'autoLockMinutes',
  'lockOnBrowserStart',
  'lockAfterSwitch',
  'confirmBeforeSwitch',
  'theme',
  'auditEnabled',
  'debugLogging',
  'preferredPopupGrouping',
] as const;

/**
 * 纯内存合并计划：不写存储、不改本机数据，供预览与正式导入共用，
 * 保证「预览里看到的数量 / 重命名」与真正执行完全一致。
 */
export function buildMergePlan(input: {
  file: TransferFile;
  local: TransferLocalState;
  conflict: TransferConflictMode;
}): TransferMergePlan {
  const { file, local, conflict } = input;
  if (conflict !== 'overwrite' && conflict !== 'keep-both') {
    throw new FlowError('E_VALIDATION', { field: 'conflict' });
  }

  const importedSystems = file.data.systems.map(parseSystem);
  const importedGroups = file.data.groups.map(parseGroup);
  const importedAccounts = file.data.accounts.map(parseAccount);
  assertUniqueIds(importedSystems, 'systems');
  assertUniqueIds(importedGroups, 'groups');
  assertUniqueIds(importedAccounts, 'accounts');

  const now = Date.now();
  const added: TransferCountSummary = { systems: 0, accounts: 0, groups: 0 };
  const overwritten: TransferCountSummary = { systems: 0, accounts: 0, groups: 0 };
  const keptBoth: TransferCountSummary = { systems: 0, accounts: 0, groups: 0 };
  const renames: TransferRenamePreview[] = [];
  const systemIdMap: Record<string, string> = {};
  const groupIdMap: Record<string, string> = {};

  // ---- 系统 ----
  const mergedSystems = [...local.systems];
  const systemIndex = new Map(local.systems.map((system, index) => [system.id, index]));
  const usedSystemNames = new Set(local.systems.map((system) => system.name.toLowerCase()));

  for (const imported of importedSystems) {
    const existingIndex = systemIndex.get(imported.id);
    if (existingIndex !== undefined) {
      const existing = mergedSystems[existingIndex];
      if (!existing) throw fail('systems', 'invalid-local');
      if (conflict === 'overwrite') {
        usedSystemNames.delete(existing.name.toLowerCase());
        const name = uniqueName(imported.name, usedSystemNames, LIMITS.systemName, false);
        if (name !== imported.name) renames.push({ kind: 'system', from: imported.name, to: name });
        mergedSystems[existingIndex] = {
          ...existing,
          ...imported,
          name,
          // 权限属于本机环境，覆盖配置时不搬运来源浏览器的授权结果
          permissionState: existing.permissionState,
          originPermissions: existing.originPermissions,
          createdAt: existing.createdAt,
          updatedAt: now,
        };
        overwritten.systems += 1;
      } else {
        const id = newSystemId();
        systemIdMap[imported.id] = id;
        const name = uniqueName(imported.name, usedSystemNames, LIMITS.systemName, true);
        renames.push({ kind: 'system', from: imported.name, to: name });
        mergedSystems.push({
          ...imported,
          id,
          name,
          permissionState: 'unknown',
          originPermissions: {},
          createdAt: imported.createdAt,
          updatedAt: now,
        });
        keptBoth.systems += 1;
      }
      continue;
    }

    const name = uniqueName(imported.name, usedSystemNames, LIMITS.systemName, false);
    if (name !== imported.name) renames.push({ kind: 'system', from: imported.name, to: name });
    mergedSystems.push({
      ...imported,
      name,
      permissionState: 'unknown',
      originPermissions: {},
      createdAt: imported.createdAt,
      updatedAt: now,
    });
    added.systems += 1;
  }

  // ---- 分组 ----
  const mergedGroups = [...local.groups];
  const groupIndex = new Map(local.groups.map((group, index) => [group.id, index]));
  const usedGroupNames = new Set(local.groups.map((group) => group.name.toLowerCase()));

  for (const imported of importedGroups) {
    const existingIndex = groupIndex.get(imported.id);
    if (existingIndex !== undefined) {
      const existing = mergedGroups[existingIndex];
      if (!existing) throw fail('groups', 'invalid-local');
      if (conflict === 'overwrite') {
        usedGroupNames.delete(existing.name.toLowerCase());
        const name = uniqueName(imported.name, usedGroupNames, LIMITS.groupName, false);
        if (name !== imported.name) renames.push({ kind: 'group', from: imported.name, to: name });
        mergedGroups[existingIndex] = {
          ...existing,
          ...imported,
          name,
          createdAt: existing.createdAt,
          updatedAt: now,
        };
        overwritten.groups += 1;
      } else {
        const id = newGroupId();
        groupIdMap[imported.id] = id;
        const name = uniqueName(imported.name, usedGroupNames, LIMITS.groupName, true);
        renames.push({ kind: 'group', from: imported.name, to: name });
        mergedGroups.push({ ...imported, id, name, createdAt: imported.createdAt, updatedAt: now });
        keptBoth.groups += 1;
      }
      continue;
    }

    const name = uniqueName(imported.name, usedGroupNames, LIMITS.groupName, false);
    if (name !== imported.name) renames.push({ kind: 'group', from: imported.name, to: name });
    mergedGroups.push({ ...imported, name, createdAt: imported.createdAt, updatedAt: now });
    added.groups += 1;
  }

  // ---- 账号 ----
  const mergedAccounts = [...local.accounts];
  const accountIndex = new Map(local.accounts.map((account, index) => [account.id, index]));
  const accountIdMap: Record<string, string> = {};
  const systemIds = new Set<string>(mergedSystems.map((system) => system.id as string));
  const groupIds = new Set<string>(mergedGroups.map((group) => group.id as string));

  for (const imported of importedAccounts) {
    const mappedSystemId = systemIdMap[imported.systemId] ?? imported.systemId;
    if (!systemIds.has(mappedSystemId)) throw fail('accounts', 'unknown-system');

    const mappedGroupId = imported.groupId
      ? groupIdMap[imported.groupId] ?? imported.groupId
      : null;
    if (mappedGroupId && !groupIds.has(mappedGroupId)) throw fail('accounts', 'unknown-group');

    const next: Account = {
      ...imported,
      systemId: mappedSystemId as SystemId,
      groupId: mappedGroupId as GroupId | null,
    };

    const existingIndex = accountIndex.get(imported.id);
    if (existingIndex !== undefined) {
      const existing = mergedAccounts[existingIndex];
      if (!existing) throw fail('accounts', 'invalid-local');
      if (conflict === 'overwrite') {
        mergedAccounts[existingIndex] = {
          ...existing,
          ...next,
          createdAt: existing.createdAt,
          updatedAt: now,
        };
        overwritten.accounts += 1;
      } else {
        const id = newAccountId();
        accountIdMap[imported.id] = id;
        const label = withSuffix(imported.label, LIMITS.accountLabel);
        renames.push({ kind: 'account', from: imported.label, to: label });
        mergedAccounts.push({ ...next, id, label, createdAt: imported.createdAt, updatedAt: now });
        keptBoth.accounts += 1;
      }
      continue;
    }

    mergedAccounts.push({ ...next, createdAt: imported.createdAt, updatedAt: now });
    added.accounts += 1;
  }

  // ---- 设置：本机已写过的偏好优先，缺项才用导入值 ----
  const localSettings = isRecord(local.settingsRaw) ? local.settingsRaw : {};
  const fileSettings = file.data.settings;
  const settingsRaw: Record<string, unknown> = { ...localSettings };
  for (const key of SETTINGS_PREFERENCE_KEYS) {
    if (localSettings[key] === undefined) settingsRaw[key] = fileSettings[key];
  }

  const localActive =
    typeof localSettings.activeSystemId === 'string' ? localSettings.activeSystemId : null;
  const importedActive =
    typeof fileSettings.activeSystemId === 'string' ? fileSettings.activeSystemId : null;
  let activeSystemId: string | null = null;
  if (localActive && systemIds.has(localActive)) activeSystemId = localActive;
  else if (importedActive && systemIds.has(importedActive)) activeSystemId = importedActive;
  else {
    activeSystemId =
      mergedSystems.find((system) => system.enabled)?.id ?? mergedSystems[0]?.id ?? null;
  }
  settingsRaw.activeSystemId = activeSystemId;

  const remembered: Record<string, string> = {};
  const localRemembered = isRecord(localSettings.rememberedSystems)
    ? localSettings.rememberedSystems
    : {};
  const importedRemembered = isRecord(fileSettings.rememberedSystems)
    ? fileSettings.rememberedSystems
    : {};
  for (const [key, value] of Object.entries({ ...importedRemembered, ...localRemembered })) {
    if (typeof value === 'string' && systemIds.has(value)) remembered[key] = value;
  }
  settingsRaw.rememberedSystems = remembered;

  const settings = normalizeSettings(settingsRaw);

  // ---- 悬浮球：位置与关闭记录按 origin 合并，本机已有值优先 ----
  const localEnabled = local.floatRaw.enabled;
  const float: FloatPrefs = {
    enabled: typeof localEnabled === 'boolean' ? localEnabled : file.data.float.enabled === true,
    dismissed: { ...readDismissed(file.data.float.dismissed), ...readDismissed(local.floatRaw.dismissed) },
    positions: { ...readPositions(file.data.float.positions), ...readPositions(local.floatRaw.positions) },
  };

  return {
    systems: mergedSystems,
    accounts: mergedAccounts,
    groups: mergedGroups,
    settings,
    float,
    systemIdMap,
    groupIdMap,
    accountIdMap,
    renames,
    added,
    overwritten,
    keptBoth,
  };
}
