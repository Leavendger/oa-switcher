import { FlowError } from '../../shared/types/errors';
import type { SystemId } from '../../shared/types/ids';
import { readSystems } from '../../storage/repo';
import { reconcileContentScripts } from '../contentRegistry';

/** 查询（不申请）系统域名权限。申请动作必须由用户在 Options 页内触发以保留手势。 */
export async function ensurePermissionForSystem(
  systemId: SystemId,
): Promise<{ granted: boolean; origins: string[] }> {
  const system = (await readSystems()).find((item) => item.id === systemId);
  if (!system || system.origins.length === 0) {
    throw new FlowError('E_VALIDATION', { field: 'systemId' });
  }

  const origins = system.origins.map((origin) => `${origin}/*`);
  const granted = await chrome.permissions.contains({ origins });
  if (!granted) {
    throw new FlowError('E_NO_PERMISSION', { systemId: system.id, origin: system.origins[0] ?? '' });
  }

  await reconcileContentScripts();
  return { granted: true, origins };
}
