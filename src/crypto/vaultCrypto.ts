import { base64ToBytes, bytesToBase64 } from '../shared/base64';
import { DEFAULT_MASTER_KEY_ITERATIONS } from '../shared/constants';
import { FlowError } from '../shared/types/errors';
import { decryptBytes, encryptBytes, IV_BYTES, newIv, newSalt, SALT_BYTES, VAULT_AAD } from './aesgcm';
import { assertIterations, deriveVaultKey } from './kdf';

export interface VaultEnvelope {
  schemaVersion: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; saltB64: string };
  cipher: { name: 'AES-GCM'; ivB64: string };
  aad: string;
  ciphertextB64: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultEntry {
  password: string;
}

export interface VaultPlaintext {
  schemaVersion: 1;
  entries: Record<string, VaultEntry>;
}

export interface OpenedVault {
  plaintext: VaultPlaintext;
  key: CryptoKey;
}

export function createEmptyVault(): VaultPlaintext {
  return { schemaVersion: 1, entries: {} };
}

function corrupt(): FlowError {
  return new FlowError('E_INTERNAL', { reason: 'vault-corrupt' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeB64(value: unknown, expectedBytes: number | null): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) throw corrupt();
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throw corrupt();
  }
  if (expectedBytes !== null && bytes.length !== expectedBytes) throw corrupt();
  return bytes;
}

/** 信封结构校验；缺省返回 null，结构非法抛 E_INTERNAL(vault-corrupt)。 */
export function parseVaultEnvelope(raw: unknown): VaultEnvelope | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw) || raw.schemaVersion !== 1) throw corrupt();

  const kdf = raw.kdf;
  if (!isRecord(kdf) || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') throw corrupt();
  const iterations = typeof kdf.iterations === 'number' ? kdf.iterations : 0;
  try {
    assertIterations(iterations);
  } catch {
    throw corrupt();
  }
  decodeB64(kdf.saltB64, SALT_BYTES);

  const cipher = raw.cipher;
  if (!isRecord(cipher) || cipher.name !== 'AES-GCM') throw corrupt();
  decodeB64(cipher.ivB64, IV_BYTES);

  if (raw.aad !== VAULT_AAD) throw corrupt();
  if (typeof raw.ciphertextB64 !== 'string' || raw.ciphertextB64.length === 0) throw corrupt();
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') throw corrupt();

  return {
    schemaVersion: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      saltB64: kdf.saltB64 as string,
    },
    cipher: { name: 'AES-GCM', ivB64: cipher.ivB64 as string },
    aad: raw.aad,
    ciphertextB64: raw.ciphertextB64,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function encodePlaintext(plaintext: VaultPlaintext): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(plaintext));
}

function parsePlaintext(bytes: Uint8Array): VaultPlaintext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw corrupt();
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.entries)) throw corrupt();

  const entries: Record<string, VaultEntry> = {};
  for (const [accountId, entry] of Object.entries(parsed.entries)) {
    if (!isRecord(entry) || typeof entry.password !== 'string') throw corrupt();
    entries[accountId] = { password: entry.password };
  }
  return { schemaVersion: 1, entries };
}

/** 用已解密的内存 key 解密信封（每次读写都会重新解密，明文不常驻）。 */
export async function openVaultWithKey(envelope: VaultEnvelope, key: CryptoKey): Promise<VaultPlaintext> {
  const iv = decodeB64(envelope.cipher.ivB64, IV_BYTES);
  const ciphertext = decodeB64(envelope.ciphertextB64, null);
  const plaintextBytes = await decryptBytes(key, iv, ciphertext, VAULT_AAD);
  try {
    return parsePlaintext(plaintextBytes);
  } finally {
    plaintextBytes.fill(0);
  }
}

/** 新 IV 重新加密整库，保留原 salt/iterations 与 createdAt。 */
export async function resealWithKey(
  envelope: VaultEnvelope,
  key: CryptoKey,
  plaintext: VaultPlaintext,
): Promise<VaultEnvelope> {
  const iv = newIv();
  const plaintextBytes = encodePlaintext(plaintext);
  try {
    const ciphertext = await encryptBytes(key, iv, plaintextBytes, VAULT_AAD);
    return {
      ...envelope,
      cipher: { name: 'AES-GCM', ivB64: bytesToBase64(iv) },
      aad: VAULT_AAD,
      ciphertextB64: bytesToBase64(ciphertext),
      updatedAt: new Date().toISOString(),
    };
  } finally {
    plaintextBytes.fill(0);
  }
}

/** 初始化 / 改主密码：新 salt + 新 key + 新 IV 重新封装。 */
export async function sealVault(
  plaintext: VaultPlaintext,
  password: string,
  options: { iterations?: number } = {},
): Promise<{ envelope: VaultEnvelope; key: CryptoKey }> {
  const iterations = options.iterations ?? DEFAULT_MASTER_KEY_ITERATIONS;
  const salt = newSalt();
  const key = await deriveVaultKey(password, salt, iterations);
  const now = new Date().toISOString();

  const envelope: VaultEnvelope = {
    schemaVersion: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, saltB64: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', ivB64: bytesToBase64(newIv()) },
    aad: VAULT_AAD,
    ciphertextB64: '',
    createdAt: now,
    updatedAt: now,
  };

  const resealed = await resealWithKey(envelope, key, plaintext);
  return { envelope: resealed, key };
}

/** 用信封内 salt/iterations 重新派生并解密。认证失败 → E_MASTER_INVALID。 */
export async function openVault(envelope: VaultEnvelope, password: string): Promise<OpenedVault> {
  const salt = decodeB64(envelope.kdf.saltB64, SALT_BYTES);
  const key = await deriveVaultKey(password, salt, envelope.kdf.iterations);
  const plaintext = await openVaultWithKey(envelope, key);
  return { plaintext, key };
}
