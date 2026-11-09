import { FlowError } from '../../shared/types/errors';
import type { TransferMode } from '../../shared/types/transfer';
import { buildTransferFile } from '../../shared/transferPackage';
import {
  readAccounts,
  readGroups,
  readSettings,
  readSystems,
  readVaultRaw,
} from '../../storage/repo';
import { readFloatPrefs } from './uiPrefsService';

/**
 * 导出模块的硬约束：只读取存储中的密文字段，绝不 import / 调用任何解密能力。
 * 单测会扫描本文件源码，禁止出现保险库解密相关符号。
 */
function appVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
}

function fileNameFor(mode: TransferMode): string {
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  return `oa-switcher-backup-${stamp}-${mode}.json`;
}

export async function exportTransfer(
  mode: TransferMode,
): Promise<{ content: string; fileName: string; bytes: number }> {
  if (mode !== 'full' && mode !== 'config') {
    throw new FlowError('E_VALIDATION', { field: 'mode' });
  }

  const [systems, accounts, groups, settings, float, vaultRaw] = await Promise.all([
    readSystems(),
    readAccounts(),
    readGroups(),
    readSettings(),
    readFloatPrefs(),
    readVaultRaw(),
  ]);

  // 仅完整模式携带信封；仅配置模式连密文都不放进文件。
  const vault = mode === 'full' && vaultRaw !== undefined && vaultRaw !== null ? vaultRaw : null;
  const { schemaVersion: _schemaVersion, ...settingsData } = settings;

  const file = await buildTransferFile({
    mode,
    appVersion: appVersion(),
    systems,
    accounts,
    groups,
    settings: settingsData,
    float,
    vault,
  });

  const content = JSON.stringify(file, null, 2);
  return { content, fileName: fileNameFor(mode), bytes: new TextEncoder().encode(content).length };
}
