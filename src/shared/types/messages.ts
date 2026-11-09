import type { Account, AccountDraft, AccountGroup, GroupDraft } from './account';
import type { AccountId, GroupId, RunId, SystemId } from './ids';
import type { ContentPingData, FlowStateSnapshot } from './flow';
import type { DiscoveryResult, SelfCheckResult } from './discovery';
import type { Settings, VaultState } from './settings';
import type {
  TransferImportOptions,
  TransferImportResult,
  TransferMode,
  TransferPreview,
} from './transfer';
import type { FloatPrefs } from './ui';
import type {
  ActiveTabResolution,
  AdapterTimeouts,
  OASystem,
  OASystemDraft,
  OaVendor,
} from './system';

export type EmptyPayload = Record<string, never>;

/**
 * oa.* 命令的公共上下文。adapterConfig 由 Background 从系统配置下发，
 * Content Script 只消费、不持久化；timeouts 可覆盖默认值。
 */
export interface OaRequestBase {
  runId: RunId;
  systemId: SystemId;
  vendor: OaVendor;
  adapterConfig?: Record<string, unknown>;
  timeouts?: Partial<AdapterTimeouts>;
}

export interface AppBootstrapData {
  settings: Settings;
  systems: OASystem[];
  groups: AccountGroup[];
  accounts: Account[];
  vault: { state: VaultState };
}

export interface RequestPayloadMap {
  'app.bootstrap': EmptyPayload;
  'settings.get': EmptyPayload;
  'settings.update': { patch: Partial<Settings> };
  'system.list': EmptyPayload;
  'system.create': { draft: OASystemDraft };
  'system.update': { id: SystemId; patch: Partial<OASystemDraft> };
  'system.delete': { id: SystemId; deleteAccounts?: boolean };
  'system.pingActiveTab': { systemId?: SystemId };
  'system.resolveActiveTab': EmptyPayload;
  'system.resolveForUrl': { url: string };
  'system.openOaTab': { systemId?: SystemId };
  'system.discover': { url: string; vendor: OaVendor };
  'system.selfCheck': { systemId: SystemId };
  'group.list': EmptyPayload;
  'group.create': { draft: GroupDraft };
  'group.update': { id: GroupId; patch: Partial<GroupDraft> };
  'group.delete': { id: GroupId };
  'account.list': EmptyPayload;
  'account.create': { draft: AccountDraft };
  'account.update': { id: AccountId; draft: AccountDraft };
  'account.delete': { id: AccountId };
  'vault.status': EmptyPayload;
  'vault.init': { masterPassword: string };
  'vault.unlock': { masterPassword: string };
  'vault.lock': EmptyPayload;
  'vault.changeMaster': { current: string; next: string };
  'flow.start': { accountId: AccountId; systemId?: SystemId };
  'flow.cancel': { runId: RunId };
  'flow.getState': EmptyPayload;
  'permission.ensure': { systemId: SystemId };
  'data.export': { mode: TransferMode };
  'data.preview': { content: string; sourceMasterPassword?: string };
  'data.import': TransferImportOptions;
  'ui.getFloatPrefs': EmptyPayload;
  'ui.setFloatEnabled': { enabled: boolean };
  'ui.dismissFloat': { origin: string };
  'ui.restoreFloatSite': { origin: string };
  'ui.saveFloatPosition': { origin: string; point: { x: number; y: number } };
  'content.ready': { url: string; title: string; frame: 'top' | 'sub' };
  'content.ping': { runId?: RunId };
  'oa.detectLoginState': OaRequestBase;
  'oa.waitForLoginPage': OaRequestBase & { timeoutMs: number };
  'oa.fillCredentials': OaRequestBase & { username: string; password: string };
  'oa.submitLogin': OaRequestBase;
  'oa.verifyLogin': OaRequestBase & { deadlineAt: number };
  'oa.logout': OaRequestBase & { timeoutMs: number };
  'oa.detectBlockers': OaRequestBase;
  'oa.cancel': OaRequestBase;
}

export type RequestType = keyof RequestPayloadMap;

export type LoginState = 'loggedIn' | 'loggedOut' | 'unknown';

export interface LoginStateReport {
  state: LoginState;
  evidence: { kind: string; detail: Record<string, string | number | boolean> }[];
}

export type VerificationOutcome = 'success' | 'failure' | 'unknown';

export interface LoginVerification {
  outcome: VerificationOutcome;
  evidence: { kind: string; detail: Record<string, string | number | boolean> }[];
}

export interface BlockerReport {
  blockedBy: 'captcha' | 'mfa' | null;
}

export interface ResponseDataMap {
  'app.bootstrap': AppBootstrapData;
  'settings.get': Settings;
  'settings.update': Settings;
  'system.list': OASystem[];
  'system.create': OASystem;
  'system.update': OASystem;
  'system.delete': {
    deleted: true;
    deletedAccountCount: number;
    credentialCleanup: 'removed' | 'partial' | 'skipped';
    permissionRemoved: boolean;
    permissionWarning: 'permission-may-remain' | null;
    cleanedFloatOrigins: number;
  };
  'system.pingActiveTab': ContentPingData;
  'system.resolveActiveTab': ActiveTabResolution;
  'system.resolveForUrl': ActiveTabResolution;
  'system.openOaTab': { tabId: number; created: boolean };
  'system.discover': DiscoveryResult;
  'system.selfCheck': SelfCheckResult;
  'group.list': AccountGroup[];
  'group.create': AccountGroup;
  'group.update': AccountGroup;
  'group.delete': { deleted: true };
  'account.list': Account[];
  'account.create': Account;
  'account.update': Account;
  'account.delete': { deleted: true; credentialRemoved: boolean };
  'vault.status': { state: VaultState };
  'vault.init': { state: VaultState };
  'vault.unlock': { state: VaultState };
  'vault.lock': { state: VaultState };
  'vault.changeMaster': { state: VaultState };
  'flow.start': { runId: RunId };
  'flow.cancel': { state: 'cancelled' };
  'flow.getState': FlowStateSnapshot | null;
  'permission.ensure': { granted: boolean; origins: string[] };
  'data.export': { content: string; fileName: string; bytes: number };
  'data.preview': TransferPreview;
  'data.import': TransferImportResult;
  'ui.getFloatPrefs': FloatPrefs;
  'ui.setFloatEnabled': { saved: true };
  'ui.dismissFloat': { dismissed: true };
  'ui.restoreFloatSite': { restored: true };
  'ui.saveFloatPosition': { saved: true };
  'content.ready': { received: true };
  'content.ping': ContentPingData;
  'oa.detectLoginState': LoginStateReport;
  'oa.waitForLoginPage': { ready: true };
  'oa.fillCredentials': { filled: true };
  'oa.submitLogin': { submitted: true };
  'oa.verifyLogin': LoginVerification;
  'oa.logout': { loggedOut: true };
  'oa.detectBlockers': BlockerReport;
  'oa.cancel': { cancelled: true };
}

export const REQUEST_TYPES = [
  'app.bootstrap',
  'settings.get',
  'settings.update',
  'system.list',
  'system.create',
  'system.update',
  'system.delete',
  'system.pingActiveTab',
  'system.resolveActiveTab',
  'system.resolveForUrl',
  'system.openOaTab',
  'system.discover',
  'system.selfCheck',
  'group.list',
  'group.create',
  'group.update',
  'group.delete',
  'account.list',
  'account.create',
  'account.update',
  'account.delete',
  'vault.status',
  'vault.init',
  'vault.unlock',
  'vault.lock',
  'vault.changeMaster',
  'flow.start',
  'flow.cancel',
  'flow.getState',
  'permission.ensure',
  'data.export',
  'data.preview',
  'data.import',
  'ui.getFloatPrefs',
  'ui.setFloatEnabled',
  'ui.dismissFloat',
  'ui.restoreFloatSite',
  'ui.saveFloatPosition',
  'content.ready',
  'content.ping',
  'oa.detectLoginState',
  'oa.waitForLoginPage',
  'oa.fillCredentials',
  'oa.submitLogin',
  'oa.verifyLogin',
  'oa.logout',
  'oa.detectBlockers',
  'oa.cancel',
] as const satisfies readonly RequestType[];

export function isRequestType(value: unknown): value is RequestType {
  return typeof value === 'string' && (REQUEST_TYPES as readonly string[]).includes(value);
}
