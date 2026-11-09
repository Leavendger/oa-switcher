import { MAX_ID_LENGTH, MAX_MESSAGE_BYTES } from '../constants';
import { TRANSFER_MAX_CONTENT_BYTES } from '../types/transfer';
import { failed, ok, serializeError, type Result } from '../result';
import type { FlowStateEvent, FlowStateSnapshot, VaultStateEvent } from '../types/flow';
import { FlowError, type SerializedError } from '../types/errors';
import {
  isRequestType,
  type RequestPayloadMap,
  type RequestType,
} from '../types/messages';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface RequestEnvelope<K extends RequestType = RequestType> {
  kind: 'req';
  id: string;
  type: K;
  payload: RequestPayloadMap[K];
  createdAt: number;
}

export type AnyRequestEnvelope = {
  [K in RequestType]: RequestEnvelope<K>;
}[RequestType];

export interface SuccessEnvelope<T> {
  kind: 'res';
  id: string;
  ok: true;
  data: T;
  elapsedMs: number;
}

export interface FailureEnvelope {
  kind: 'res';
  id: string;
  ok: false;
  error: SerializedError;
  elapsedMs: number;
}

export type ResponseEnvelope<T = unknown> = SuccessEnvelope<T> | FailureEnvelope;

export type AnyResponseEnvelope = ResponseEnvelope<unknown>;

function createRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `req_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createRequest<K extends RequestType>(
  type: K,
  payload: RequestPayloadMap[K],
): RequestEnvelope<K> {
  return { kind: 'req', id: createRequestId(), type, payload, createdAt: Date.now() };
}

const REQUIRED_PAYLOAD_FIELDS: Partial<Record<RequestType, readonly string[]>> = {
  'settings.update': ['patch'],
  'system.create': ['draft'],
  'system.update': ['id', 'patch'],
  'system.delete': ['id'],
  'system.discover': ['url', 'vendor'],
  'system.selfCheck': ['systemId'],
  'group.create': ['draft'],
  'group.update': ['id', 'patch'],
  'group.delete': ['id'],
  'account.create': ['draft'],
  'account.update': ['id', 'draft'],
  'account.delete': ['id'],
  'vault.init': ['masterPassword'],
  'vault.unlock': ['masterPassword'],
  'vault.changeMaster': ['current', 'next'],
  'flow.start': ['accountId'],
  'flow.cancel': ['runId'],
  'permission.ensure': ['systemId'],
  'data.export': ['mode'],
  'data.preview': ['content'],
  'data.import': ['content', 'conflict', 'vault'],
  'oa.detectLoginState': ['runId', 'systemId', 'vendor'],
  'oa.fillCredentials': ['runId', 'systemId', 'vendor', 'username', 'password'],
  'oa.verifyLogin': ['runId', 'systemId', 'vendor', 'deadlineAt'],
  'oa.cancel': ['runId', 'systemId', 'vendor'],
};

/**
 * 仅数据迁移两条消息需要传整份备份文件，单独放宽到 8MB；
 * 其余消息继续沿用 32KB 上限，不放宽全局校验。
 */
const PAYLOAD_LIMITS: Partial<Record<RequestType, number>> = {
  'data.preview': TRANSFER_MAX_CONTENT_BYTES,
  'data.import': TRANSFER_MAX_CONTENT_BYTES,
};

function invalid(detail: Record<string, string | number | boolean>): Result<never, SerializedError> {
  return failed(serializeError(new FlowError('E_VALIDATION', detail)));
}

export function parseRequest(raw: unknown): Result<AnyRequestEnvelope, SerializedError> {
  if (!isRecord(raw)) return invalid({ field: 'envelope', reason: 'not-object' });
  if (raw.kind !== 'req') return invalid({ field: 'kind', reason: 'expected-req' });

  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
    return invalid({ field: 'id', reason: 'invalid' });
  }

  const type = raw.type;
  if (!isRequestType(type)) return invalid({ field: 'type', reason: 'unknown-type' });

  const payload = raw.payload;
  if (!isRecord(payload)) return invalid({ field: 'payload', reason: 'not-object' });

  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) {
    return invalid({ field: 'createdAt', reason: 'invalid' });
  }

  let size = 0;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return invalid({ field: 'envelope', reason: 'unserializable' });
  }
  const limit = PAYLOAD_LIMITS[type] ?? MAX_MESSAGE_BYTES;
  if (size > limit) {
    return invalid({ field: 'payload', reason: 'too-large', elapsedMs: size, limit });
  }

  for (const key of REQUIRED_PAYLOAD_FIELDS[type] ?? []) {
    if (!(key in payload)) return invalid({ field: key, reason: 'missing' });
  }

  return ok(raw as unknown as AnyRequestEnvelope);
}

export function createSuccess<T>(id: string, data: T, elapsedMs: number): SuccessEnvelope<T> {
  return { kind: 'res', id, ok: true, data, elapsedMs };
}

export function createFailure(id: string, error: SerializedError, elapsedMs: number): FailureEnvelope {
  return { kind: 'res', id, ok: false, error, elapsedMs };
}

export function isResponseEnvelope(raw: unknown): raw is AnyResponseEnvelope {
  return isRecord(raw) && raw.kind === 'res' && typeof raw.id === 'string' && typeof raw.ok === 'boolean';
}

export function isFlowStateEvent(raw: unknown): raw is FlowStateEvent {
  if (!isRecord(raw)) return false;
  if (raw.kind !== 'evt' || raw.type !== 'flow.state') return false;
  const snapshot = raw.snapshot;
  return isRecord(snapshot) && typeof snapshot.runId === 'string' && typeof snapshot.state === 'string';
}

export function isVaultStateEvent(raw: unknown): raw is VaultStateEvent {
  if (!isRecord(raw)) return false;
  if (raw.kind !== 'evt' || raw.type !== 'vault.state') return false;
  return raw.state === 'uninitialized' || raw.state === 'locked' || raw.state === 'unlocked';
}

export function isFlowStateSnapshot(raw: unknown): raw is FlowStateSnapshot {
  return (
    isRecord(raw) &&
    typeof raw.runId === 'string' &&
    typeof raw.state === 'string' &&
    typeof raw.accountId === 'string' &&
    typeof raw.updatedAt === 'number'
  );
}
