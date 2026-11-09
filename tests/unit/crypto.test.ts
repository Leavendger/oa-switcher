// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decryptBytes, encryptBytes, newIv, newSalt, VAULT_AAD } from '../../src/crypto/aesgcm';
import { deriveVaultKey } from '../../src/crypto/kdf';
import {
  createEmptyVault,
  openVault,
  openVaultWithKey,
  parseVaultEnvelope,
  resealWithKey,
  sealVault,
} from '../../src/crypto/vaultCrypto';
import { FlowError, isFlowError } from '../../src/shared/types/errors';

const ITERATIONS = 100_000;
const PASSWORD = 'correct horse battery staple';

async function expectCode(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(isFlowError(error)).toBe(true);
    expect((error as FlowError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('PBKDF2 / AES-GCM', () => {
  it('派生的 CryptoKey 不可导出，且能完成加解密回环', async () => {
    const salt = newSalt();
    expect(salt).toHaveLength(16);

    const key = await deriveVaultKey(PASSWORD, salt, ITERATIONS);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });

    const iv = newIv();
    expect(iv).toHaveLength(12);
    const ciphertext = await encryptBytes(key, iv, new TextEncoder().encode('hello vault'));
    const plaintext = await decryptBytes(key, iv, ciphertext);
    expect(new TextDecoder().decode(plaintext)).toBe('hello vault');
  });

  it('错误密钥解密返回 E_MASTER_INVALID', async () => {
    const salt = newSalt();
    const key = await deriveVaultKey(PASSWORD, salt, ITERATIONS);
    const otherKey = await deriveVaultKey('wrong password', salt, ITERATIONS);
    const iv = newIv();
    const ciphertext = await encryptBytes(key, iv, new TextEncoder().encode('secret'));

    await expectCode(decryptBytes(otherKey, iv, ciphertext), 'E_MASTER_INVALID');
  });

  it('AAD 不匹配时解密失败', async () => {
    const key = await deriveVaultKey(PASSWORD, newSalt(), ITERATIONS);
    const iv = newIv();
    const ciphertext = await encryptBytes(key, iv, new TextEncoder().encode('secret'), 'other-aad');

    await expectCode(decryptBytes(key, iv, ciphertext, VAULT_AAD), 'E_MASTER_INVALID');
  });

  it('每次 IV / salt 都不重复', () => {
    expect(newIv()).not.toEqual(newIv());
    expect(newSalt()).not.toEqual(newSalt());
  });

  it('迭代数低于下限被拒绝', async () => {
    await expectCode(deriveVaultKey(PASSWORD, newSalt(), 99_999), 'E_VALIDATION');
  });
});

describe('保险库信封', () => {
  it('整库封装后可解封，条目完整', async () => {
    const plaintext = createEmptyVault();
    plaintext.entries['acc_test'] = { password: 'hunter2-account' };

    const { envelope, key } = await sealVault(plaintext, PASSWORD, { iterations: ITERATIONS });
    expect(envelope.aad).toBe(VAULT_AAD);
    expect(envelope.kdf.iterations).toBe(ITERATIONS);
    expect(key.extractable).toBe(false);

    const opened = await openVault(envelope, PASSWORD);
    expect(opened.plaintext.entries['acc_test']?.password).toBe('hunter2-account');

    // 密文与信封序列化后不含明文密码
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('hunter2-account');
    expect(serialized).not.toContain(PASSWORD);
  });

  it('错误主密码解封返回 E_MASTER_INVALID', async () => {
    const { envelope } = await sealVault(createEmptyVault(), PASSWORD, { iterations: ITERATIONS });
    await expectCode(openVault(envelope, 'wrong password'), 'E_MASTER_INVALID');
  });

  it('re-seal 使用新 IV，但保留 salt 与 createdAt', async () => {
    const { envelope, key } = await sealVault(createEmptyVault(), PASSWORD, {
      iterations: ITERATIONS,
    });
    const next = createEmptyVault();
    next.entries['acc_x'] = { password: 'p' };

    const resealed = await resealWithKey(envelope, key, next);
    expect(resealed.cipher.ivB64).not.toBe(envelope.cipher.ivB64);
    expect(resealed.kdf.saltB64).toBe(envelope.kdf.saltB64);
    expect(resealed.createdAt).toBe(envelope.createdAt);

    const opened = await openVaultWithKey(resealed, key);
    expect(opened.entries['acc_x']?.password).toBe('p');
  });

  it('结构损坏的信封被拒绝', async () => {
    await expectCode(sealVault(createEmptyVault(), PASSWORD, { iterations: ITERATIONS }).then(
      ({ envelope }) => Promise.resolve(parseVaultEnvelope({ ...envelope, aad: 'tampered' })),
    ), 'E_INTERNAL');

    expect(parseVaultEnvelope(null)).toBeNull();
    expect(parseVaultEnvelope(undefined)).toBeNull();
  });
});
