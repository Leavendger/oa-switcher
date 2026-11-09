import type { AppBootstrapData } from '../../shared/types/messages';
import { readAccounts, readGroups, readSettings, readSystems } from '../../storage/repo';
import { vaultService } from './vaultService';

/** Popup 首屏聚合请求，减少往返。 */
export async function getBootstrap(): Promise<AppBootstrapData> {
  const [settings, systems, groups, accounts, vault] = await Promise.all([
    readSettings(),
    readSystems(),
    readGroups(),
    readAccounts(),
    vaultService.status(),
  ]);

  return {
    settings,
    systems,
    groups,
    accounts,
    // 只暴露状态，绝不下发明文或派生密钥
    vault,
  };
}
