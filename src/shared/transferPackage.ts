import { SUPPORTED_SCHEMA_VERSION } from '../storage/migrations';
import { FlowError } from './types/errors';
import {
  TRANSFER_FORMAT,
  TRANSFER_SECTIONS,
  TRANSFER_VERSION,
  type TransferData,
  type TransferFile,
  type TransferIntegrity,
  type TransferMode,
  type TransferSection,
  type TransferSectionIntegrity,
  type TransferSettings,
} from './types/transfer';
import type { Account, AccountGroup } from './types/account';
import type { OASystem } from './types/system';
import type { FloatPrefs } from './types/ui';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 对象键递归排序后再序列化，保证同一份数据在不同环境得到相同 hash。 */
function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForHash(item));
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) output[key] = normalizeForHash(item);
    }
    return output;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForHash(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sectionCount(section: TransferSection, value: unknown): number {
  if (section === 'settings' || section === 'float') return 1;
  if (section === 'vault') return value === null || value === undefined ? 0 : 1;
  return Array.isArray(value) ? value.length : 0;
}

async function hashSection(section: TransferSection, value: unknown): Promise<TransferSectionIntegrity> {
  return {
    count: sectionCount(section, value),
    hash: await sha256Hex(stableStringify(value ?? null)),
  };
}

function invalid(field: string, reason: string): FlowError {
  return new FlowError('E_TRANSFER_INVALID', { field, reason });
}

export interface TransferBuildInput {
  mode: TransferMode;
  appVersion: string;
  systems: OASystem[];
  accounts: Account[];
  groups: AccountGroup[];
  settings: TransferSettings;
  float: FloatPrefs;
  /** 完整模式传保险库原始信封；仅配置模式传 null。 */
  vault: unknown | null;
  exportedAt?: string;
}

/** 组装导出文件并计算每段 hash + 整体 digest。不解析、不解密保险库。 */
export async function buildTransferFile(input: TransferBuildInput): Promise<TransferFile> {
  const data: TransferData = {
    systems: input.systems,
    accounts: input.accounts,
    groups: input.groups,
    settings: input.settings,
    float: input.float,
  };

  const payloads: Record<TransferSection, unknown> = {
    systems: data.systems,
    accounts: data.accounts,
    groups: data.groups,
    settings: data.settings,
    float: data.float,
    vault: input.vault,
  };

  const sections = {} as TransferIntegrity['sections'];
  for (const section of TRANSFER_SECTIONS) {
    sections[section] = await hashSection(section, payloads[section]);
  }
  const digest = await sha256Hex(
    stableStringify({ version: TRANSFER_VERSION, mode: input.mode, sections }),
  );

  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    appVersion: input.appVersion,
    mode: input.mode,
    data,
    vault: input.vault,
    integrity: { sections, digest },
  };
}

/**
 * 导入前完整校验：格式 → 版本 → 段结构 → 每段 count/hash → 整体 digest。
 * 任何异常都在写存储之前抛出，调用方据此保证原子性。
 */
export async function verifyTransferFile(raw: unknown): Promise<TransferFile> {
  if (!isRecord(raw)) throw invalid('format', 'not-object');
  if (raw.format !== TRANSFER_FORMAT) throw invalid('format', 'unknown-format');

  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
    throw invalid('version', 'invalid');
  }
  if ((raw.version as number) > TRANSFER_VERSION) {
    throw new FlowError('E_TRANSFER_VERSION', { field: 'version', reason: 'too-new' });
  }

  if (!Number.isInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 1) {
    throw invalid('schemaVersion', 'invalid');
  }
  if ((raw.schemaVersion as number) > SUPPORTED_SCHEMA_VERSION) {
    throw new FlowError('E_TRANSFER_VERSION', { field: 'schemaVersion', reason: 'too-new' });
  }

  if (raw.mode !== 'full' && raw.mode !== 'config') throw invalid('mode', 'invalid');
  if (typeof raw.exportedAt !== 'string' || raw.exportedAt.length === 0) {
    throw invalid('exportedAt', 'invalid');
  }
  if (typeof raw.appVersion !== 'string' || raw.appVersion.length === 0) {
    throw invalid('appVersion', 'invalid');
  }

  const data = raw.data;
  if (!isRecord(data)) throw invalid('data', 'not-object');
  if (!Array.isArray(data.systems) || !Array.isArray(data.accounts) || !Array.isArray(data.groups)) {
    throw invalid('data', 'invalid-sections');
  }
  if (!isRecord(data.settings) || !isRecord(data.float)) {
    throw invalid('data', 'invalid-sections');
  }

  if (raw.mode === 'config' && raw.vault !== null && raw.vault !== undefined) {
    throw invalid('vault', 'config-mode-with-vault');
  }
  if (raw.vault !== null && raw.vault !== undefined && !isRecord(raw.vault)) {
    throw invalid('vault', 'invalid-envelope');
  }

  const integrity = raw.integrity;
  if (!isRecord(integrity) || !isRecord(integrity.sections) || typeof integrity.digest !== 'string') {
    throw invalid('integrity', 'missing');
  }

  const payloads: Record<TransferSection, unknown> = {
    systems: data.systems,
    accounts: data.accounts,
    groups: data.groups,
    settings: data.settings,
    float: data.float,
    vault: raw.vault ?? null,
  };

  for (const section of TRANSFER_SECTIONS) {
    const expected = integrity.sections[section];
    if (!isRecord(expected) || !Number.isInteger(expected.count) || typeof expected.hash !== 'string') {
      throw invalid('integrity', section);
    }
    const actual = await hashSection(section, payloads[section]);
    if (actual.count !== expected.count || actual.hash !== expected.hash) {
      throw invalid('integrity', section);
    }
  }

  const digest = await sha256Hex(
    stableStringify({ version: raw.version, mode: raw.mode, sections: integrity.sections }),
  );
  if (digest !== integrity.digest) throw invalid('integrity', 'digest');

  return raw as unknown as TransferFile;
}

export const TRANSFER_SECTION_LABELS: Record<TransferSection, string> = {
  systems: 'OA 系统',
  accounts: '账号',
  groups: '分组',
  settings: '设置',
  float: '悬浮球偏好',
  vault: '凭证密文',
};

export function transferSectionLabel(section: string): string {
  return TRANSFER_SECTION_LABELS[section as TransferSection] ?? section;
}
