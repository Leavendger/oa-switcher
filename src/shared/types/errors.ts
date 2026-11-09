export const ERROR_CODES = [
  'E_VALIDATION',
  'E_FLOW_BUSY',
  'E_VAULT_NOT_INITIALIZED',
  'E_VAULT_LOCKED',
  'E_MASTER_INVALID',
  'E_CRYPTO_UNAVAILABLE',
  'E_CREDENTIAL_MISSING',
  'E_NO_PERMISSION',
  'E_NO_OA_TAB',
  'E_CONTENT_UNAVAILABLE',
  'E_SYSTEM_AMBIGUOUS',
  'E_SYSTEM_IN_USE',
  'E_SYSTEM_UNSUPPORTED',
  'E_TRANSFER_INVALID',
  'E_TRANSFER_VERSION',
  'E_CONFIG_MISSING',
  'E_LOGIN_PAGE_TIMEOUT',
  'E_FORM_NOT_FOUND',
  'E_FILL_FAILED',
  'E_SUBMIT_FAILED',
  'E_LOGOUT_TRIGGER_FAILED',
  'E_LOGOUT_TIMEOUT',
  'E_STATE_UNKNOWN',
  'E_LOGIN_REJECTED',
  'E_VERIFY_TIMEOUT',
  'E_BLOCKED_CAPTCHA',
  'E_BLOCKED_MFA',
  'E_DISCOVERY_FAILED',
  'E_DISCOVERY_TIMEOUT',
  'E_DISCOVERY_BLOCKED',
  'E_CANCELLED',
  'E_TIMEOUT',
  'E_INTERRUPTED',
  'E_NOT_IMPLEMENTED',
  'E_INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorCategory =
  | 'validation'
  | 'security'
  | 'permission'
  | 'environment'
  | 'adapter'
  | 'flow'
  | 'internal';

export type ErrorDetailValue = string | number | boolean;

export interface SerializedError {
  code: ErrorCode;
  category: ErrorCategory;
  retryable: boolean;
  detail?: Record<string, ErrorDetailValue>;
}

export const ERROR_META = {
  E_VALIDATION: { category: 'validation', retryable: false },
  E_FLOW_BUSY: { category: 'validation', retryable: true },
  E_VAULT_NOT_INITIALIZED: { category: 'security', retryable: false },
  E_VAULT_LOCKED: { category: 'security', retryable: true },
  E_MASTER_INVALID: { category: 'security', retryable: true },
  E_CRYPTO_UNAVAILABLE: { category: 'security', retryable: false },
  E_CREDENTIAL_MISSING: { category: 'security', retryable: false },
  E_NO_PERMISSION: { category: 'permission', retryable: true },
  E_NO_OA_TAB: { category: 'environment', retryable: true },
  E_CONTENT_UNAVAILABLE: { category: 'environment', retryable: true },
  E_SYSTEM_AMBIGUOUS: { category: 'environment', retryable: true },
  E_SYSTEM_IN_USE: { category: 'validation', retryable: false },
  E_SYSTEM_UNSUPPORTED: { category: 'adapter', retryable: false },
  E_TRANSFER_INVALID: { category: 'validation', retryable: false },
  E_TRANSFER_VERSION: { category: 'validation', retryable: false },
  E_CONFIG_MISSING: { category: 'adapter', retryable: true },
  E_LOGIN_PAGE_TIMEOUT: { category: 'adapter', retryable: true },
  E_FORM_NOT_FOUND: { category: 'adapter', retryable: true },
  E_FILL_FAILED: { category: 'adapter', retryable: true },
  E_SUBMIT_FAILED: { category: 'adapter', retryable: true },
  E_LOGOUT_TRIGGER_FAILED: { category: 'adapter', retryable: true },
  E_LOGOUT_TIMEOUT: { category: 'adapter', retryable: true },
  E_STATE_UNKNOWN: { category: 'adapter', retryable: true },
  E_LOGIN_REJECTED: { category: 'adapter', retryable: false },
  E_VERIFY_TIMEOUT: { category: 'adapter', retryable: true },
  E_BLOCKED_CAPTCHA: { category: 'adapter', retryable: false },
  E_BLOCKED_MFA: { category: 'adapter', retryable: false },
  E_DISCOVERY_FAILED: { category: 'environment', retryable: true },
  E_DISCOVERY_TIMEOUT: { category: 'environment', retryable: true },
  E_DISCOVERY_BLOCKED: { category: 'environment', retryable: true },
  E_CANCELLED: { category: 'flow', retryable: true },
  E_TIMEOUT: { category: 'flow', retryable: true },
  E_INTERRUPTED: { category: 'flow', retryable: true },
  E_NOT_IMPLEMENTED: { category: 'flow', retryable: false },
  E_INTERNAL: { category: 'internal', retryable: true },
} satisfies Record<ErrorCode, { category: ErrorCategory; retryable: boolean }>;

export class FlowError extends Error {
  readonly code: ErrorCode;
  readonly detail: Record<string, ErrorDetailValue> | undefined;

  constructor(code: ErrorCode, detail?: Record<string, ErrorDetailValue>) {
    super(code);
    this.name = 'FlowError';
    this.code = code;
    this.detail = detail;
  }
}

export function isFlowError(value: unknown): value is FlowError {
  return value instanceof FlowError;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
