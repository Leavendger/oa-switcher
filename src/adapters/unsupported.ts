import { FlowError } from '../shared/types/errors';
import type {
  BlockerReport,
  LoginStateReport,
  LoginVerification,
} from '../shared/types/messages';
import type { OaVendor } from '../shared/types/system';
import type {
  AdapterCapabilities,
  AdapterConfigValidation,
  AdapterContext,
  CredentialInput,
  LoginPageReport,
  OaAdapter,
} from './types';

/** 其他厂商占位实现：v1 只预留接口，任何调用都明确报不支持。 */
export class UnsupportedAdapter implements OaAdapter {
  readonly vendor: OaVendor = 'other';

  readonly capabilities: AdapterCapabilities = {
    loginStateDetection: false,
    logout: false,
    urlRuleMatching: false,
    version: '0.0.0-unsupported',
  };

  validateConfig(_config: unknown): AdapterConfigValidation {
    throw new FlowError('E_SYSTEM_UNSUPPORTED');
  }

  detectLoginPage(_context: AdapterContext): Promise<LoginPageReport> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }

  detectLoginState(_context: AdapterContext): Promise<LoginStateReport> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }

  detectBlockers(_context: AdapterContext): Promise<BlockerReport> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }

  logout(_context: AdapterContext): Promise<void> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }

  waitForLoginPage(_context: AdapterContext): Promise<void> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }

  fillCredentials(_context: AdapterContext, _credential: CredentialInput): Promise<void> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }

  submitLogin(_context: AdapterContext): Promise<void> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }

  verifyLogin(_context: AdapterContext, _options: { deadlineAt: number }): Promise<LoginVerification> {
    return Promise.reject(new FlowError('E_SYSTEM_UNSUPPORTED'));
  }
}
