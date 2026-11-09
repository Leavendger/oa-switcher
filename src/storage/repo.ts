import type { Account, AccountGroup } from '../shared/types/account';
import type { SystemId } from '../shared/types/ids';
import {
  DEFAULT_SETTINGS,
  type PopupGrouping,
  type Settings,
  type ThemePreference,
} from '../shared/types/settings';
import type { OASystem, PermissionState } from '../shared/types/system';
import type { FloatPrefs } from '../shared/types/ui';
import { STORAGE_KEYS } from './keys';

export interface ExtensionMeta {
  schemaVersion: number;
  installedAt: number;
  updatedAt: number;
}

async function readValue<T>(key: string, fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(key);
  const value: unknown = stored[key];
  return value === undefined ? fallback : (value as T);
}

async function writeValue(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function themeOf(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function groupingOf(value: unknown): PopupGrouping {
  return value === 'flat' ? 'flat' : 'grouped';
}

function permissionStateOf(value: unknown): PermissionState {
  return value === 'granted' || value === 'denied' ? value : 'unknown';
}

/** 只保留字符串键值，避免历史脏数据破坏「记住本次选择」的作用域判断。 */
function rememberedSystemsOf(value: unknown): Record<string, SystemId> {
  if (!isRecord(value)) return {};
  const output: Record<string, SystemId> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.length > 0) output[key] = item as SystemId;
  }
  return output;
}

export function normalizeSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  return {
    schemaVersion: 1,
    activeSystemId: typeof raw.activeSystemId === 'string' ? (raw.activeSystemId as SystemId) : null,
    rememberedSystems: rememberedSystemsOf(raw.rememberedSystems),
    autoLockMinutes: clampedNumber(raw.autoLockMinutes, DEFAULT_SETTINGS.autoLockMinutes, 0, 120),
    lockOnBrowserStart: booleanOr(raw.lockOnBrowserStart, DEFAULT_SETTINGS.lockOnBrowserStart),
    lockAfterSwitch: booleanOr(raw.lockAfterSwitch, DEFAULT_SETTINGS.lockAfterSwitch),
    confirmBeforeSwitch: booleanOr(raw.confirmBeforeSwitch, DEFAULT_SETTINGS.confirmBeforeSwitch),
    theme: themeOf(raw.theme),
    auditEnabled: booleanOr(raw.auditEnabled, DEFAULT_SETTINGS.auditEnabled),
    debugLogging: booleanOr(raw.debugLogging, DEFAULT_SETTINGS.debugLogging),
    preferredPopupGrouping: groupingOf(raw.preferredPopupGrouping),
  };
}

export async function readSettings(): Promise<Settings> {
  return normalizeSettings(await readValue<unknown>(STORAGE_KEYS.settings, undefined));
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await readSettings()), ...patch });
  await writeValue(STORAGE_KEYS.settings, next);
  return next;
}

async function readList<T>(key: string): Promise<T[]> {
  const value = await readValue<unknown>(key, undefined);
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * 兼容历史数据：旧版本系统没有 urlSignatures / originPermissions 字段。
 * 统一在读取时补齐，避免各消费方散落空值判断。
 */
export function normalizeSystem(raw: unknown): OASystem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;

  const origins = Array.isArray(raw.origins)
    ? raw.origins.filter((item): item is string => typeof item === 'string')
    : [];
  const urlSignatures = Array.isArray(raw.urlSignatures)
    ? raw.urlSignatures.filter((item): item is string => typeof item === 'string')
    : [];

  const originPermissions: Record<string, PermissionState> = {};
  if (isRecord(raw.originPermissions)) {
    for (const [origin, state] of Object.entries(raw.originPermissions)) {
      originPermissions[origin] = permissionStateOf(state);
    }
  }

  return {
    ...(raw as unknown as OASystem),
    origins,
    urlSignatures,
    originPermissions,
    permissionState: permissionStateOf(raw.permissionState),
  };
}

export async function readSystems(): Promise<OASystem[]> {
  const list = await readList<unknown>(STORAGE_KEYS.systems);
  return list
    .map((item) => normalizeSystem(item))
    .filter((item): item is OASystem => item !== null);
}

export async function writeSystems(systems: OASystem[]): Promise<void> {
  await writeValue(STORAGE_KEYS.systems, systems);
}

export async function readAccounts(): Promise<Account[]> {
  return readList<Account>(STORAGE_KEYS.accounts);
}

export async function writeAccounts(accounts: Account[]): Promise<void> {
  await writeValue(STORAGE_KEYS.accounts, accounts);
}

/** 同一次 storage.set 写入 systems 与 accounts，保证删除系统时引用不留孤儿。 */
export async function writeSystemsAndAccounts(
  systems: OASystem[],
  accounts: Account[],
): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.systems]: systems,
    [STORAGE_KEYS.accounts]: accounts,
  });
}

export async function readGroups(): Promise<AccountGroup[]> {
  return readList<AccountGroup>(STORAGE_KEYS.groups);
}

export async function writeGroups(groups: AccountGroup[]): Promise<void> {
  await writeValue(STORAGE_KEYS.groups, groups);
}

/** 原样读写保险库信封，解析与加解密由 background 层的 vaultService 负责。 */
export async function readVaultRaw(): Promise<unknown> {
  return readValue<unknown>(STORAGE_KEYS.vault, undefined);
}

export async function writeVaultRaw(envelope: unknown): Promise<void> {
  await writeValue(STORAGE_KEYS.vault, envelope);
}

/** 同一次 storage.set 写入 accounts 与 groups，保证删除分组时「解绑账号」是原子的。 */
export async function writeAccountsAndGroups(
  accounts: Account[],
  groups: AccountGroup[],
): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.accounts]: accounts,
    [STORAGE_KEYS.groups]: groups,
  });
}

export async function readMeta(): Promise<ExtensionMeta | null> {
  const value = await readValue<unknown>(STORAGE_KEYS.meta, undefined);
  if (!isRecord(value) || typeof value.schemaVersion !== 'number') return null;
  return {
    schemaVersion: value.schemaVersion,
    installedAt: typeof value.installedAt === 'number' ? value.installedAt : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  };
}

export async function writeMeta(meta: ExtensionMeta): Promise<void> {
  await writeValue(STORAGE_KEYS.meta, meta);
}

/** 读取未经归一化的原始值，用于判断「本机是否真的写过该配置」。 */
export async function readRaw(key: string): Promise<unknown> {
  return readValue<unknown>(key, undefined);
}

export interface TransferSnapshotInput {
  systems: OASystem[];
  accounts: Account[];
  groups: AccountGroup[];
  settings: Settings;
  float: FloatPrefs;
  /** 缺省表示本次导入不改动保险库密文。 */
  vault?: unknown;
}

/**
 * 导入专用：systems / accounts / groups / settings / 悬浮球偏好（以及可选的保险库）
 * 在同一次 storage.set 内写入，任一步失败都不会留下「导入一半」的状态。
 */
export async function writeTransferSnapshot(input: TransferSnapshotInput): Promise<void> {
  const items: Record<string, unknown> = {
    [STORAGE_KEYS.systems]: input.systems,
    [STORAGE_KEYS.accounts]: input.accounts,
    [STORAGE_KEYS.groups]: input.groups,
    [STORAGE_KEYS.settings]: input.settings,
    [STORAGE_KEYS.floatEnabled]: input.float.enabled,
    [STORAGE_KEYS.floatDismissed]: input.float.dismissed,
    [STORAGE_KEYS.floatPositions]: input.float.positions,
  };
  if (input.vault !== undefined) items[STORAGE_KEYS.vault] = input.vault;
  await chrome.storage.local.set(items);
}
