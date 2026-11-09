import type { SystemId } from './ids';

export type ThemePreference = 'system' | 'light' | 'dark';
export type PopupGrouping = 'flat' | 'grouped';

export interface Settings {
  schemaVersion: 1;
  activeSystemId: SystemId | null;
  /**
   * 同域多系统歧义时用户手动选择的记忆。
   * key 为 origin + 目录前缀（如 http://oa.example.com/oa/），只在该路径前缀内生效。
   */
  rememberedSystems: Record<string, SystemId>;
  autoLockMinutes: number;
  lockOnBrowserStart: boolean;
  lockAfterSwitch: boolean;
  confirmBeforeSwitch: boolean;
  theme: ThemePreference;
  auditEnabled: boolean;
  debugLogging: boolean;
  preferredPopupGrouping: PopupGrouping;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  activeSystemId: null,
  rememberedSystems: {},
  autoLockMinutes: 15,
  lockOnBrowserStart: true,
  lockAfterSwitch: false,
  confirmBeforeSwitch: true,
  theme: 'system',
  auditEnabled: false,
  debugLogging: false,
  preferredPopupGrouping: 'grouped',
};

export type VaultState = 'uninitialized' | 'locked' | 'unlocked';
