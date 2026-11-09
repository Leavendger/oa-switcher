import { toArrayBuffer } from '../shared/bytes';
import { DEFAULT_MASTER_KEY_ITERATIONS, MIN_MASTER_KEY_ITERATIONS } from '../shared/constants';
import { log } from '../shared/log';
import { FlowError } from '../shared/types/errors';

export const SALT_BYTES = 16;

/** Web Crypto 不可用时统一返回 E_CRYPTO_UNAVAILABLE（例如非安全上下文）。 */
export function requireSubtle(): SubtleCrypto {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || typeof webCrypto.subtle?.deriveKey !== 'function') {
    throw new FlowError('E_CRYPTO_UNAVAILABLE');
  }
  return webCrypto.subtle;
}

export function assertIterations(iterations: number): number {
  if (!Number.isInteger(iterations) || iterations < MIN_MASTER_KEY_ITERATIONS) {
    throw new FlowError('E_VALIDATION', { field: 'iterations' });
  }
  return iterations;
}

/**
 * PBKDF2-HMAC-SHA256 → AES-GCM-256。
 * 返回的 CryptoKey 不可导出，且只允许 encrypt/decrypt。
 */
export async function deriveVaultKey(
  password: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_MASTER_KEY_ITERATIONS,
): Promise<CryptoKey> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new FlowError('E_VALIDATION', { field: 'masterPassword' });
  }
  if (salt.length !== SALT_BYTES) {
    throw new FlowError('E_VALIDATION', { field: 'salt' });
  }

  const checkedIterations = assertIterations(iterations);
  const subtle = requireSubtle();
  const startedAt = Date.now();

  const material = await subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: checkedIterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  log.debug('vault-kdf', { elapsedMs: Date.now() - startedAt, attempt: checkedIterations });
  return key;
}
