import { MAX_ID_LENGTH } from '../constants';
import { serializeError } from '../result';
import { FlowError } from '../types/errors';
import type { RequestPayloadMap, RequestType, ResponseDataMap } from '../types/messages';
import {
  createFailure,
  createSuccess,
  isRecord,
  parseRequest,
  type AnyResponseEnvelope,
} from './protocol';

export interface DispatchContext {
  readonly sender: chrome.runtime.MessageSender | null;
}

export type Handler<K extends RequestType> = (
  payload: RequestPayloadMap[K],
  context: DispatchContext,
) => Promise<ResponseDataMap[K]>;

export type RouteTable = { [K in RequestType]?: Handler<K> };

type LooseHandler = (payload: unknown, context: DispatchContext) => Promise<unknown>;

export function isExtensionSender(sender: chrome.runtime.MessageSender | null): boolean {
  if (!sender) return false;
  return typeof sender.id === 'string' && sender.id === chrome.runtime.id;
}

export async function dispatchRequest(
  raw: unknown,
  routes: RouteTable,
  context: DispatchContext,
): Promise<AnyResponseEnvelope> {
  const startedAt = Date.now();
  const fallbackId =
    isRecord(raw) && typeof raw.id === 'string' ? raw.id.slice(0, MAX_ID_LENGTH) : 'unknown';

  const parsed = parseRequest(raw);
  if (!parsed.ok) {
    return createFailure(fallbackId, parsed.error, Date.now() - startedAt);
  }

  const request = parsed.value;
  const handler = (routes as Partial<Record<RequestType, LooseHandler>>)[request.type];
  const elapsed = (): number => Date.now() - startedAt;

  if (!handler) {
    return createFailure(
      request.id,
      serializeError(new FlowError('E_NOT_IMPLEMENTED', { type: request.type })),
      elapsed(),
    );
  }

  try {
    const data = await handler(request.payload, context);
    return createSuccess(request.id, data, elapsed());
  } catch (error) {
    return createFailure(request.id, serializeError(error), elapsed());
  }
}
