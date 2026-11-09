import type { RouteTable } from '../shared/messaging/server';
import { FlowError } from '../shared/types/errors';
import { pingActiveTab } from './contentMessenger';
import { flowRunner } from './flow/runner';
import { createAccount, deleteAccount, listAccounts, updateAccount } from './services/accountService';
import { getBootstrap } from './services/bootstrapService';
import { discoverSystem } from './services/discoveryService';
import { createGroup, deleteGroup, listGroups, updateGroup } from './services/groupService';
import { ensurePermissionForSystem } from './services/permissionService';
import { selfCheckSystem } from './services/selfCheckService';
import { getSettings, markUserActivity, updateSettings } from './services/settingsService';
import { createSystem, deleteSystem, listSystems, updateSystem } from './services/systemService';
import { openOaTab, resolveActiveTab, resolveUrl } from './services/systemResolutionService';
import { exportTransfer } from './services/transferExport';
import { importTransfer, previewTransferImport } from './services/transferImport';
import {
  dismissFloatSite,
  normalizeFloatOrigin,
  readFloatPrefs,
  restoreFloatSite,
  saveFloatPosition,
  setFloatEnabled,
} from './services/uiPrefsService';
import { vaultService } from './services/vaultService';
import { notifyVaultState } from './services/vaultNotifier';

/**
 * Background 路由表。
 * 阶段二实现 bootstrap / settings / system / group / account / vault / permission。
 * 阶段四由 FlowRunner 执行真实切换编排，oa.* 由 content bridge 处理。
 */
export const routes: RouteTable = {
  'app.bootstrap': () => getBootstrap(),
  'settings.get': () => getSettings(),
  'settings.update': ({ patch }) => updateSettings(patch),
  'system.list': () => listSystems(),
  'system.create': ({ draft }) => createSystem(draft),
  'system.update': ({ id, patch }) => updateSystem(id, patch),
  'system.delete': ({ id, deleteAccounts }) => deleteSystem(id, { deleteAccounts }),
  'system.pingActiveTab': ({ systemId }) => {
    markUserActivity();
    return pingActiveTab(systemId);
  },
  'system.resolveActiveTab': () => {
    markUserActivity();
    return resolveActiveTab();
  },
  'system.resolveForUrl': ({ url }) => resolveUrl(url),
  'system.openOaTab': ({ systemId }) => {
    markUserActivity();
    return openOaTab(systemId);
  },
  'system.discover': ({ url, vendor }) => discoverSystem({ url, vendor }),
  'system.selfCheck': ({ systemId }) => selfCheckSystem(systemId),
  'ui.getFloatPrefs': () => readFloatPrefs(),
  'ui.setFloatEnabled': async ({ enabled }) => {
    if (typeof enabled !== 'boolean') throw new FlowError('E_VALIDATION', { field: 'enabled' });
    await setFloatEnabled(enabled);
    return { saved: true as const };
  },
  'ui.dismissFloat': async ({ origin }) => {
    const normalized = normalizeFloatOrigin(origin);
    if (!normalized) throw new FlowError('E_VALIDATION', { field: 'origin' });
    await dismissFloatSite(normalized);
    return { dismissed: true as const };
  },
  'ui.restoreFloatSite': async ({ origin }) => {
    const normalized = normalizeFloatOrigin(origin);
    if (!normalized) throw new FlowError('E_VALIDATION', { field: 'origin' });
    await restoreFloatSite(normalized);
    return { restored: true as const };
  },
  'ui.saveFloatPosition': async ({ origin, point }) => {
    const normalized = normalizeFloatOrigin(origin);
    if (!normalized) throw new FlowError('E_VALIDATION', { field: 'origin' });
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      throw new FlowError('E_VALIDATION', { field: 'point' });
    }
    await saveFloatPosition(normalized, { x: point.x, y: point.y });
    return { saved: true as const };
  },
  'group.list': () => listGroups(),
  'group.create': ({ draft }) => createGroup(draft),
  'group.update': ({ id, patch }) => updateGroup(id, patch),
  'group.delete': ({ id }) => deleteGroup(id),
  'account.list': () => listAccounts(),
  'account.create': ({ draft }) => createAccount(draft),
  'account.update': ({ id, draft }) => updateAccount(id, draft),
  'account.delete': ({ id }) => deleteAccount(id),
  'vault.status': () => vaultService.status(),
  'vault.init': async ({ masterPassword }) => {
    const result = await vaultService.init(masterPassword);
    await notifyVaultState();
    return result;
  },
  'vault.unlock': async ({ masterPassword }) => {
    const result = await vaultService.unlock(masterPassword);
    await notifyVaultState();
    return result;
  },
  'vault.lock': async () => {
    const result = await vaultService.lock();
    await notifyVaultState();
    return result;
  },
  'vault.changeMaster': async ({ current, next }) => {
    const result = await vaultService.changeMaster(current, next);
    await notifyVaultState();
    return result;
  },
  'flow.start': ({ accountId, systemId }) => {
    markUserActivity();
    return flowRunner.start({ accountId, systemId });
  },
  'flow.cancel': ({ runId }) => flowRunner.cancel(runId),
  'flow.getState': () => Promise.resolve(flowRunner.getSnapshot()),
  'permission.ensure': ({ systemId }) => ensurePermissionForSystem(systemId),
  'data.export': ({ mode }) => exportTransfer(mode),
  'data.preview': ({ content, sourceMasterPassword }) =>
    previewTransferImport(content, sourceMasterPassword),
  'data.import': async (options) => {
    const result = await importTransfer(options);
    markUserActivity();
    return result;
  },
  'content.ready': () => Promise.resolve({ received: true as const }),
};
