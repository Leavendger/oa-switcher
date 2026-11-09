import type { Account, AccountGroup } from './account';
import type { SystemId } from './ids';
import type { Settings, VaultState } from './settings';
import type { OASystem } from './system';
import type { FloatPrefs } from './ui';

export const TRANSFER_FORMAT = 'oa-switcher.transfer';
export const TRANSFER_VERSION = 1;

/** 仅 data.preview / data.import 放宽到 8MB，其余消息仍走 32KB 上限。 */
export const TRANSFER_MAX_CONTENT_BYTES = 8 * 1024 * 1024;

export const TRANSFER_SECTIONS = [
  'systems',
  'accounts',
  'groups',
  'settings',
  'float',
  'vault',
] as const;

export type TransferSection = (typeof TRANSFER_SECTIONS)[number];

export type TransferMode = 'full' | 'config';

export type TransferConflictMode = 'overwrite' | 'keep-both';

export type TransferVaultMode = 'auto' | 'skip' | 'adopt' | 'merge' | 'replace';

/** 导出时去掉本机 schemaVersion，导入后由 normalizeSettings 统一补全。 */
export type TransferSettings = Omit<Settings, 'schemaVersion'>;

export interface TransferSectionIntegrity {
  count: number;
  hash: string;
}

export interface TransferIntegrity {
  sections: Record<TransferSection, TransferSectionIntegrity>;
  digest: string;
}

export interface TransferData {
  systems: OASystem[];
  accounts: Account[];
  groups: AccountGroup[];
  settings: TransferSettings;
  float: FloatPrefs;
}

export interface TransferFile {
  format: typeof TRANSFER_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  mode: TransferMode;
  data: TransferData;
  /** 完整模式为保险库信封原样；仅配置模式为 null。导出过程不解析、不解密。 */
  vault: unknown | null;
  integrity: TransferIntegrity;
}

export interface TransferSectionDiff {
  added: number;
  sameId: number;
  totalLocal: number;
}

export interface TransferRenamePreview {
  kind: 'system' | 'group' | 'account';
  from: string;
  to: string;
}

export interface TransferVaultPreview {
  packageHasVault: boolean;
  targetState: VaultState;
  /** 来源主密码是否能解开导入信封；未提供密码时为 null。 */
  passwordVerified: boolean | null;
  /** 来源主密码是否等于目标主密码；目标未初始化或未提供密码时为 null。 */
  sameAsTarget: boolean | null;
  canAdopt: boolean;
  canMerge: boolean;
  requiresChoice: boolean;
}

export interface TransferPreview {
  file: {
    mode: TransferMode;
    version: number;
    schemaVersion: number;
    exportedAt: string;
    appVersion: string;
    systemCount: number;
    accountCount: number;
    groupCount: number;
    hasVault: boolean;
  };
  target: {
    vaultState: VaultState;
    systemCount: number;
    accountCount: number;
    groupCount: number;
  };
  diff: {
    systems: TransferSectionDiff;
    accounts: TransferSectionDiff;
    groups: TransferSectionDiff;
  };
  /** 保留双方时会重命名的条目，执行前必须展示给用户。 */
  renames: TransferRenamePreview[];
  vault: TransferVaultPreview;
  warnings: string[];
}

export interface TransferImportOptions {
  content: string;
  conflict: TransferConflictMode;
  vault: TransferVaultMode;
  sourceMasterPassword?: string;
  confirmReplace?: boolean;
}

export interface TransferCountSummary {
  systems: number;
  accounts: number;
  groups: number;
}

export interface TransferImportResult {
  added: TransferCountSummary;
  overwritten: TransferCountSummary;
  keptBoth: TransferCountSummary;
  renamed: TransferRenamePreview[];
  activeSystemId: SystemId | null;
  vaultAction: 'unchanged' | 'skipped' | 'adopted' | 'merged' | 'replaced';
  credentialsImported: boolean;
  warnings: string[];
}
