import { toArrayBuffer } from '../shared/bytes';
import { FlowError } from '../shared/types/errors';
import { requireSubtle } from './kdf';

/** 绑定保险库格式版本，阻止跨版本移植密文。 */
export const VAULT_AAD = 'oa-switcher.vault.v1';

export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export const newSalt = (): Uint8Array => randomBytes(SALT_BYTES);
export const newIv = (): Uint8Array => randomBytes(IV_BYTES);

const encoder = new TextEncoder();

function aadBytes(aad: string): Uint8Array {
  return encoder.encode(aad);
}

export async function encryptBytes(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: string = VAULT_AAD,
): Promise<Uint8Array> {
  if (iv.length !== IV_BYTES) throw new FlowError('E_VALIDATION', { field: 'iv' });
  try {
    const buffer = await requireSubtle().encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aadBytes(aad)) },
      key,
      toArrayBuffer(plaintext),
    );
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError('E_INTERNAL', { reason: 'encrypt-failed' });
  }
}

/**
 * GCM 认证失败无法区分「主密码错误」与「数据被篡改」，按 D5/§6.2 统一返回 E_MASTER_INVALID。
 */
export async function decryptBytes(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: string = VAULT_AAD,
): Promise<Uint8Array> {
  if (iv.length !== IV_BYTES) throw new FlowError('E_VALIDATION', { field: 'iv' });
  try {
    const buffer = await requireSubtle().decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aadBytes(aad)) },
      key,
      toArrayBuffer(ciphertext),
    );
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError('E_MASTER_INVALID');
  }
}
