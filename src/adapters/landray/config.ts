import type { AdapterTimeouts } from '../../shared/types/system';

/**
 * 蓝凌 OA Adapter 的配置键位定义。
 * 所有值默认为空（undefined）。阶段一不包含任何具体选择器或 URL。
 * 真实取值必须由用户依据实际页面提供（见 docs/architecture.md 8.1）。
 */
export interface LandrayAdapterConfig {
  schemaVersion?: 1;
  /** 配置来源标记：由厂商预设生成时写入，供自检验证「预设是否可能已过期」。 */
  preset?: { id: string; version: string };
  loginPageUrlPattern?: string;
  loginFormReadySelector?: string;
  usernameFieldSelector?: string;
  passwordFieldSelector?: string;
  submitTrigger?: { kind: 'formSubmit' | 'click'; selector: string };
  loggedInMarkerSelector?: string;
  loggedOutMarkerSelector?: string;
  authenticatedUrlPattern?: string;
  loginFailureMarkerSelector?: string;
  logoutTrigger?: { kind: 'url'; url: string } | { kind: 'click'; selector: string; confirmSelector?: string };
  loggedOutUrlPattern?: string;
  captchaMarkerSelector?: string;
  mfaMarkerSelector?: string;
  currentAccountMarker?: string | null;
  timeouts?: Partial<AdapterTimeouts>;
  notes?: string | null;
}

export const LANDRAY_REQUIRED_KEYS = [
  'loginPageUrlPattern',
  'loginFormReadySelector',
  'usernameFieldSelector',
  'passwordFieldSelector',
  'submitTrigger',
  'logoutTrigger',
] as const;

export function parseLandrayConfig(config: Record<string, unknown>): LandrayAdapterConfig {
  return config as unknown as LandrayAdapterConfig;
}
