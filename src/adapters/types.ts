import type {
  BlockerReport,
  LoginStateReport,
  LoginVerification,
} from '../shared/types/messages';
import type { AdapterTimeouts } from '../shared/types/system';
import type { OaVendor } from '../shared/types/system';

/** 页面驱动：Adapter 唯一可用的页面访问入口，由 Content Script 注入实现。 */
export interface PageDriver {
  url(): string;
  title(): string;
  query<T extends Element>(selector: string): T | null;
  queryAll<T extends Element>(selector: string): T[];
  waitFor<T extends Element>(
    selector: string,
    options: {
      timeoutMs: number;
      signal: AbortSignal;
      timeoutCode?: 'E_TIMEOUT' | 'E_LOGIN_PAGE_TIMEOUT';
    },
  ): Promise<T>;
  waitUntil(
    predicate: () => boolean,
    options: { timeoutMs: number; pollMs: number; signal: AbortSignal },
  ): Promise<void>;
  click(element: Element): Promise<void>;
  setValue(element: Element, value: string): Promise<void>;
  submitForm(element: Element): Promise<void>;
  navigate(url: string, options: { signal: AbortSignal }): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface AdapterConfigValidation {
  ok: boolean;
  missing: string[];
}

export interface AdapterCapabilities {
  loginStateDetection: boolean;
  logout: boolean;
  urlRuleMatching: boolean;
  version: string;
}

export interface AdapterContext {
  driver: PageDriver;
  config: Record<string, unknown>;
  timeouts: AdapterTimeouts;
  signal: AbortSignal;
}

export interface CredentialInput {
  username: string;
  password: string;
}

export interface LoginPageReport {
  isLoginPage: boolean;
  formReady: boolean;
}

/**
 * OA 厂商适配接口。所有方法只允许依赖 PageDriver 与配置，
 * 不得访问 storage、不得发消息、不得知道账号库存在。
 */
export interface OaAdapter {
  readonly vendor: OaVendor;
  readonly capabilities: AdapterCapabilities;

  validateConfig(config: unknown): AdapterConfigValidation;
  detectLoginPage(context: AdapterContext): Promise<LoginPageReport>;
  detectLoginState(context: AdapterContext): Promise<LoginStateReport>;
  detectBlockers(context: AdapterContext): Promise<BlockerReport>;
  logout(context: AdapterContext): Promise<void>;
  waitForLoginPage(context: AdapterContext): Promise<void>;
  fillCredentials(context: AdapterContext, credential: CredentialInput): Promise<void>;
  submitLogin(context: AdapterContext): Promise<void>;
  verifyLogin(context: AdapterContext, options: { deadlineAt: number }): Promise<LoginVerification>;
  /** 取消后的清理：只清空已填写字段，不触发提交；未配置字段时跳过。 */
  clearCredentials?(context: AdapterContext): Promise<void>;
}
