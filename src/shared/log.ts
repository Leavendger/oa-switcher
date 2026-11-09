import { EXTENSION_NAME } from './constants';
import { isFlowError } from './types/errors';

const SENSITIVE_KEY = /password|passwd|pwd|cookie|token|authorization|secret|sessionid/i;
const URL_KEY = /(url|href|page|origin)/i;

let debugEnabled = false;

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

function trimToOrigin(value: string): string {
  try {
    return new URL(value, 'http://unknown.local').origin;
  } catch {
    return '[invalid-url]';
  }
}

/** 脱敏：敏感键打码、URL 裁剪到 origin、嵌套对象浅层递归。可单独测试。 */
export function sanitizeRecord(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      output[key] = URL_KEY.test(key) ? trimToOrigin(value) : value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
      output[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      output[key] = value.map((item) => {
        if (typeof item === 'string') return URL_KEY.test(key) ? trimToOrigin(item) : item;
        if (item !== null && typeof item === 'object') {
          return sanitizeRecord(item as Record<string, unknown>, depth + 1);
        }
        return item;
      });
      continue;
    }
    if (typeof value === 'object' && depth < 1) {
      output[key] = sanitizeRecord(value as Record<string, unknown>, depth + 1);
      continue;
    }
    output[key] = '[object]';
  }
  return output;
}

const prefix = `[${EXTENSION_NAME}]`;

export const log = {
  debug(event: string, data?: Record<string, unknown>): void {
    if (!debugEnabled) return;
    console.debug(prefix, event, data ? sanitizeRecord(data) : undefined);
  },
  info(event: string, data?: Record<string, unknown>): void {
    console.info(prefix, event, data ? sanitizeRecord(data) : undefined);
  },
  warn(event: string, data?: Record<string, unknown>): void {
    console.warn(prefix, event, data ? sanitizeRecord(data) : undefined);
  },
  error(event: string, error?: unknown, data?: Record<string, unknown>): void {
    const code = isFlowError(error) ? error.code : 'E_INTERNAL';
    console.error(prefix, event, { ...(data ? sanitizeRecord(data) : {}), code });
  },
};
