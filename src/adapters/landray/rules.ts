import type {
  BlockerReport,
  LoginStateReport,
  LoginVerification,
  VerificationOutcome,
} from '../../shared/types/messages';
import type { OaVendor } from '../../shared/types/system';
import type { LandrayAdapterConfig } from './config';

/** 验证信号优先级：失败证据永远压过成功证据。 */
export type VerificationSignal = 'failure' | 'success' | null;

export function selectVerificationOutcome(signals: VerificationSignal[]): VerificationOutcome {
  if (signals.includes('failure')) return 'failure';
  if (signals.includes('success')) return 'success';
  return 'unknown';
}

/**
 * URL 规则匹配已上提到 shared，由适配器与系统识别共用同一实现；
 * 这里保留同名导出，避免适配器与既有测试改动匹配语义。
 */
export { matchesUrlPattern } from '../../shared/urlMatch';

/** 阶段三使用的配置载体。 */
export type RulesConfig = Pick<
  LandrayAdapterConfig,
  'authenticatedUrlPattern' | 'loggedInMarkerSelector' | 'loggedOutMarkerSelector'
>;

export interface RulesContext {
  readonly config: RulesConfig;
}

export type RulesBlockerReport = BlockerReport;
export type RulesLoginStateReport = LoginStateReport;
export type RulesLoginVerification = LoginVerification;
export type RulesVendor = OaVendor;
