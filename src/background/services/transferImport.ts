import { openVault, parseVaultEnvelope, type VaultEnvelope } from '../../crypto/vaultCrypto';
import { FlowError } from '../../shared/types/errors';
import type {
  TransferImportOptions,
  TransferImportResult,
  TransferPreview,
  TransferVaultMode,
} from '../../shared/types/transfer';
import { verifyTransferFile } from '../../shared/transferPackage';
import { ensureSchema } from '../../storage/migrations';
import { STORAGE_KEYS } from '../../storage/keys';
import {
  readAccounts,
  readGroups,
  readRaw,
  readSystems,
  writeTransferSnapshot,
} from '../../storage/repo';
import { reconcileContentScripts } from '../contentRegistry';
import { buildMergePlan, type TransferLocalState } from './transferMerge';
import { notifyVaultState } from './vaultNotifier';
import { vaultService } from './vaultService';

function invalid(field: string, reason: string): FlowError {
  return new FlowError('E_TRANSFER_INVALID', { field, reason });
}

function parseContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw invalid('format', 'not-json');
  }
}

function readEnvelope(raw: unknown): VaultEnvelope {
  let envelope: VaultEnvelope | null;
  try {
    envelope = parseVaultEnvelope(raw);
  } catch {
    throw invalid('vault', 'invalid-envelope');
  }
  if (!envelope) throw invalid('vault', 'invalid-envelope');
  return envelope;
}

async function loadLocalState(): Promise<TransferLocalState> {
  const [systems, accounts, groups, settingsRaw, enabled, dismissed, positions] =
    await Promise.all([
      readSystems(),
      readAccounts(),
      readGroups(),
      readRaw(STORAGE_KEYS.settings),
      readRaw(STORAGE_KEYS.floatEnabled),
      readRaw(STORAGE_KEYS.floatDismissed),
      readRaw(STORAGE_KEYS.floatPositions),
    ]);
  return { systems, accounts, groups, settingsRaw, floatRaw: { enabled, dismissed, positions } };
}

async function verifySourcePassword(
  envelope: VaultEnvelope,
  password: string | undefined,
): Promise<boolean | null> {
  if (!password) return null;
  try {
    await openVault(envelope, password);
    return true;
  } catch {
    return false;
  }
}

async function verifyAgainstTarget(password: string | undefined): Promise<boolean | null> {
  if (!password) return null;
  const raw = await readRaw(STORAGE_KEYS.vault);
  if (raw === undefined || raw === null) return null;
  try {
    const localEnvelope = parseVaultEnvelope(raw);
    if (!localEnvelope) return null;
    await openVault(localEnvelope, password);
    return true;
  } catch {
    return false;
  }
}

/** 只读预览：验包、跑一遍内存合并计划，并给出保险库分支与重命名结果。 */
export async function previewTransferImport(
  content: string,
  sourceMasterPassword?: string,
): Promise<TransferPreview> {
  const file = await verifyTransferFile(parseContent(content));
  const local = await loadLocalState();
  // 预览固定按「保留双方」跑计划，这样能提前展示重命名；数量口径不受影响。
  const plan = buildMergePlan({ file, local, conflict: 'keep-both' });
  const { state } = await vaultService.status();

  const envelope = file.vault === null ? null : readEnvelope(file.vault);
  const passwordVerified = envelope
    ? await verifySourcePassword(envelope, sourceMasterPassword)
    : null;
  const sameAsTarget = envelope ? await verifyAgainstTarget(sourceMasterPassword) : null;

  const warnings: string[] = [];
  if (!envelope) {
    warnings.push('该备份不含凭证，导入后账号会保留，但需要重新设置密码。');
  } else if (state === 'uninitialized') {
    warnings.push('本机尚未初始化保险库，导入后将直接采用备份中的密码密文；解锁时请使用来源浏览器的主密码。');
  } else {
    warnings.push(
      '本机已有保险库。只有来源主密码与本机主密码一致时才能合并凭证；否则请选择「只导入配置」或「清空本机保险库后导入」。',
    );
  }
  if (plan.renames.length > 0) {
    warnings.push('选择「保留双方」时，以下条目会自动重命名，避免与本机重名。');
  }

  return {
    file: {
      mode: file.mode,
      version: file.version,
      schemaVersion: file.schemaVersion,
      exportedAt: file.exportedAt,
      appVersion: file.appVersion,
      systemCount: file.data.systems.length,
      accountCount: file.data.accounts.length,
      groupCount: file.data.groups.length,
      hasVault: envelope !== null,
    },
    target: {
      vaultState: state,
      systemCount: local.systems.length,
      accountCount: local.accounts.length,
      groupCount: local.groups.length,
    },
    diff: {
      systems: {
        added: plan.added.systems,
        sameId: plan.overwritten.systems + plan.keptBoth.systems,
        totalLocal: local.systems.length,
      },
      accounts: {
        added: plan.added.accounts,
        sameId: plan.overwritten.accounts + plan.keptBoth.accounts,
        totalLocal: local.accounts.length,
      },
      groups: {
        added: plan.added.groups,
        sameId: plan.overwritten.groups + plan.keptBoth.groups,
        totalLocal: local.groups.length,
      },
    },
    renames: plan.renames,
    vault: {
      packageHasVault: envelope !== null,
      targetState: state,
      passwordVerified,
      sameAsTarget,
      canAdopt: state === 'uninitialized' && envelope !== null,
      canMerge: state !== 'uninitialized' && sameAsTarget === true,
      requiresChoice: state !== 'uninitialized' && envelope !== null,
    },
    warnings,
  };
}

async function resolveVaultWrite(input: {
  fileVault: unknown | null;
  mode: TransferVaultMode;
  sourceMasterPassword?: string;
  confirmReplace?: boolean;
  accountIdMap: Record<string, string>;
}): Promise<{
  vault: unknown | undefined;
  action: TransferImportResult['vaultAction'];
  credentialsImported: boolean;
}> {
  const { fileVault, mode, sourceMasterPassword, confirmReplace, accountIdMap } = input;
  if (fileVault === null || fileVault === undefined) {
    return { vault: undefined, action: 'unchanged', credentialsImported: false };
  }

  const envelope = readEnvelope(fileVault);
  const { state } = await vaultService.status();

  if (mode === 'skip') return { vault: undefined, action: 'skipped', credentialsImported: false };

  if (mode === 'auto') {
    if (state !== 'uninitialized') {
      return { vault: undefined, action: 'skipped', credentialsImported: false };
    }
    return { vault: envelope, action: 'adopted', credentialsImported: true };
  }

  if (mode === 'adopt') {
    if (state !== 'uninitialized') throw new FlowError('E_VALIDATION', { field: 'vault' });
    return { vault: envelope, action: 'adopted', credentialsImported: true };
  }

  if (mode === 'merge') {
    if (state === 'uninitialized') throw new FlowError('E_VAULT_NOT_INITIALIZED');
    if (!sourceMasterPassword) {
      throw new FlowError('E_VALIDATION', { field: 'sourceMasterPassword' });
    }
    const merged = await vaultService.prepareMergedEnvelope(
      envelope,
      sourceMasterPassword,
      accountIdMap,
    );
    return { vault: merged, action: 'merged', credentialsImported: true };
  }

  if (mode === 'replace') {
    if (state === 'uninitialized') throw new FlowError('E_VAULT_NOT_INITIALIZED');
    if (confirmReplace !== true) throw new FlowError('E_VALIDATION', { field: 'confirmReplace' });
    return { vault: envelope, action: 'replaced', credentialsImported: true };
  }

  throw new FlowError('E_VALIDATION', { field: 'vault' });
}

/**
 * 正式导入：所有校验、合并计划、保险库解密均在内存完成；
 * 最后用一次 storage.set 写入全部数据，任何失败都不会留下「导入一半」。
 */
export async function importTransfer(
  options: TransferImportOptions,
): Promise<TransferImportResult> {
  const file = await verifyTransferFile(parseContent(options.content));
  const local = await loadLocalState();
  const plan = buildMergePlan({ file, local, conflict: options.conflict });

  const vaultResult = await resolveVaultWrite({
    fileVault: file.vault,
    mode: options.vault,
    sourceMasterPassword: options.sourceMasterPassword,
    confirmReplace: options.confirmReplace,
    accountIdMap: plan.accountIdMap,
  });

  // 数据走与正常读写相同的 schema 校验/迁移路径；失败时不写业务数据。
  await ensureSchema();

  await writeTransferSnapshot({
    systems: plan.systems,
    accounts: plan.accounts,
    groups: plan.groups,
    settings: plan.settings,
    float: plan.float,
    vault: vaultResult.vault,
  });

  const warnings: string[] = [];
  if (vaultResult.vault !== undefined) {
    // 信封已变化：丢弃内存 key，强制用户用对应的主密码重新解锁。
    vaultService.resetRuntime();
    await notifyVaultState();
  }
  try {
    await reconcileContentScripts();
  } catch {
    warnings.push('内容脚本注册刷新失败，请重新加载扩展后再试。');
  }

  return {
    added: plan.added,
    overwritten: plan.overwritten,
    keptBoth: plan.keptBoth,
    renamed: plan.renames,
    activeSystemId: plan.settings.activeSystemId,
    vaultAction: vaultResult.action,
    credentialsImported: vaultResult.credentialsImported,
    warnings,
  };
}
