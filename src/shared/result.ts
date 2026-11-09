import {
  ERROR_META,
  FlowError,
  isFlowError,
  type ErrorCode,
  type ErrorDetailValue,
  type SerializedError,
} from './types/errors';

const ALLOWED_DETAIL_KEYS = new Set([
  'step',
  'field',
  'missing',
  'elapsedMs',
  'httpStatus',
  'reason',
  'limit',
  'outcome',
  'origin',
  'systemId',
  'accountId',
  'accountCount',
  'vendor',
  'attempt',
  'type',
  'stage',
]);

export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Err<E> {
  ok: false;
  error: E;
}

export type Result<T, E = SerializedError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function failed<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function errorMeta(code: ErrorCode): { category: SerializedError['category']; retryable: boolean } {
  return ERROR_META[code];
}

/**
 * 将任意异常归一为可跨上下文传递的结构。
 * 绝不透出原始 message（可能含页面内容或凭证），detail 只保留白名单键与标量值。
 */
export function serializeError(error: unknown): SerializedError {
  if (!isFlowError(error)) {
    return {
      code: 'E_INTERNAL',
      category: ERROR_META.E_INTERNAL.category,
      retryable: ERROR_META.E_INTERNAL.retryable,
      detail: { reason: 'unexpected-error' },
    };
  }

  const meta = errorMeta(error.code);
  const detail: Record<string, ErrorDetailValue> = {};
  for (const [key, value] of Object.entries(error.detail ?? {})) {
    if (!ALLOWED_DETAIL_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      detail[key] = value;
    }
  }

  const result: SerializedError = {
    code: error.code,
    category: meta.category,
    retryable: meta.retryable,
  };
  if (Object.keys(detail).length > 0) result.detail = detail;
  return result;
}

export function toFlowError(error: unknown): FlowError {
  if (isFlowError(error)) return error;
  return new FlowError('E_INTERNAL');
}
