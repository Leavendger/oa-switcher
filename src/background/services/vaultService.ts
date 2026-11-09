import {
  createEmptyVault,
  openVault,
  openVaultWithKey,
  parseVaultEnvelope,
  resealWithKey,
  sealVault,
  type VaultEnvelope,
} from '../../crypto/vaultCrypto';
import { LIMITS } from '../../shared/constants';
import { log } from '../../shared/log';
import { FlowError } from '../../shared/types/errors';
import type { AccountId } from '../../shared/types/ids';
import type { VaultState } from '../../shared/types/settings';
import { readSettings, readVaultRaw, writeVaultRaw } from '../../storage/repo';

export function shouldAutoLock(lastActivityAt: number, now: number, autoLockMinutes: number): boolean {
  if (!Number.isFinite(autoLockMinutes) || autoLockMinutes <= 0) return false;
  return now - lastActivityAt >= autoLockMinutes * 60_000;
}

function assertMasterPassword(value: unknown, field: string, enforceMin: boolean): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FlowError('E_VALIDATION', { field });
  }
  if (value.length > LIMITS.masterPasswordMax) {
    throw new FlowError('E_VALIDATION', { field });
  }
  if (enforceMin && value.length < LIMITS.masterPasswordMin) {
    throw new FlowError('E_VALIDATION', { field });
  }
  return value;
}

function assertAccountPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.accountPassword) {
    throw new FlowError('E_VALIDATION', { field: 'password' });
  }
  return value;
}

/**
 * 保险库运行时：唯一持有 CryptoKey 的地方。
 * 明文只在单次读写瞬间解密，用完即丢弃；key 不落盘、不可导出。
 */
export class VaultService {
  private key: CryptoKey | null = null;
  private state: VaultState = 'uninitialized';
  private lastActivityAt = Date.now();
  private loaded = false;

  /** 单测用：清空内存态（不影响已持久化的信封）。 */
  resetRuntime(): void {
    this.key = null;
    this.state = 'uninitialized';
    this.lastActivityAt = Date.now();
    this.loaded = false;
  }

  /** SW 冷启动后按「信封是否存在」判定 uninitialized / locked，不解密。 */
  async ensureLoaded(): Promise<VaultState> {
    if (this.loaded) return this.state;
    if (this.state !== 'unlocked') {
      const raw = await readVaultRaw();
      this.state = raw === undefined || raw === null ? 'uninitialized' : 'locked';
    }
    this.loaded = true;
    return this.state;
  }

  async status(): Promise<{ state: VaultState }> {
    await this.ensureLoaded();
    return { state: this.state };
  }

  touchActivity(): void {
    this.lastActivityAt = Date.now();
  }

  async init(masterPassword: string): Promise<{ state: VaultState }> {
    await this.ensureLoaded();
    if (this.state !== 'uninitialized') {
      throw new FlowError('E_VALIDATION', { field: 'masterPassword' });
    }
    const password = assertMasterPassword(masterPassword, 'masterPassword', true);

    const { envelope, key } = await sealVault(createEmptyVault(), password);
    await writeVaultRaw(envelope);
    this.applyUnlocked(key);
    log.info('vault-initialized');
    return { state: this.state };
  }

  async unlock(masterPassword: string): Promise<{ state: VaultState }> {
    await this.ensureLoaded();
    if (this.state === 'uninitialized') throw new FlowError('E_VAULT_NOT_INITIALIZED');
    const password = assertMasterPassword(masterPassword, 'masterPassword', false);

    const envelope = await this.readEnvelope();
    if (this.state === 'unlocked' && this.key) {
      // 已解锁时仍做一次真实验证，避免「点了解锁但密码是错的」被静默放过
      await openVault(envelope, password);
      this.touchActivity();
      return { state: this.state };
    }

    const opened = await openVault(envelope, password);
    this.applyUnlocked(opened.key);
    log.info('vault-unlocked');
    return { state: this.state };
  }

  async lock(): Promise<{ state: VaultState }> {
    await this.ensureLoaded();
    this.key = null;
    if (this.state === 'unlocked') this.state = 'locked';
    log.info('vault-locked');
    return { state: this.state };
  }

  async changeMaster(current: string, next: string): Promise<{ state: VaultState }> {
    await this.ensureLoaded();
    if (this.state === 'uninitialized') throw new FlowError('E_VAULT_NOT_INITIALIZED');
    const currentPassword = assertMasterPassword(current, 'current', false);
    const nextPassword = assertMasterPassword(next, 'next', true);
    if (currentPassword === nextPassword) throw new FlowError('E_VALIDATION', { field: 'next' });

    const envelope = await this.readEnvelope();
    // 先验证当前主密码（即便已解锁也不跳过），失败统一 E_MASTER_INVALID
    const opened = await openVault(envelope, currentPassword);

    const sealed = await sealVault(opened.plaintext, nextPassword);
    const resealed: VaultEnvelope = { ...sealed.envelope, createdAt: envelope.createdAt };
    await writeVaultRaw(resealed);
    this.applyUnlocked(sealed.key);
    log.info('vault-master-changed');
    return { state: this.state };
  }

  async readPassword(accountId: AccountId): Promise<string> {
    const key = await this.requireKey();
    const envelope = await this.readEnvelope();
    const plaintext = await openVaultWithKey(envelope, key);
    const entry = plaintext.entries[accountId];
    if (!entry) throw new FlowError('E_CREDENTIAL_MISSING', { accountId });
    return entry.password;
  }

  /** 写密码：整库重加密后先落盘密文，调用方随后再写账号元数据。 */
  async writePassword(accountId: AccountId, password: string): Promise<void> {
    const value = assertAccountPassword(password);
    const key = await this.requireKey();
    const envelope = await this.readEnvelope();
    const plaintext = await openVaultWithKey(envelope, key);
    plaintext.entries[accountId] = { password: value };

    const resealed = await resealWithKey(envelope, key, plaintext);
    await writeVaultRaw(resealed);
    this.touchActivity();
    log.info('vault-credential-written', { accountId });
  }

  /** 仅用于失败回滚 / 清除密码；账号元数据删除默认不触碰密文。 */
  async removePassword(accountId: AccountId): Promise<void> {
    const key = await this.requireKey();
    const envelope = await this.readEnvelope();
    const plaintext = await openVaultWithKey(envelope, key);
    if (!(accountId in plaintext.entries)) return;

    delete plaintext.entries[accountId];
    const resealed = await resealWithKey(envelope, key, plaintext);
    await writeVaultRaw(resealed);
    this.touchActivity();
    log.info('vault-credential-removed', { accountId });
  }

  /**
   * 导入合并凭证：只有来源主密码也能解开本机信封（即两边主密码相同）才允许，
   * 否则抛 E_MASTER_INVALID，由调用方引导用户改选「仅配置」或「清空本机保险库」。
   * 返回重封装后的信封但不落盘，便于调用方与其他数据一起原子写入。
   */
  async prepareMergedEnvelope(
    imported: VaultEnvelope,
    sourcePassword: string,
    accountIdMap: Record<string, string>,
  ): Promise<VaultEnvelope> {
    await this.ensureLoaded();
    if (this.state === 'uninitialized') throw new FlowError('E_VAULT_NOT_INITIALIZED');
    const password = assertMasterPassword(sourcePassword, 'sourceMasterPassword', false);

    const localEnvelope = await this.readEnvelope();
    const local = await openVault(localEnvelope, password);
    const importedVault = await openVault(imported, password);

    for (const [accountId, entry] of Object.entries(importedVault.plaintext.entries)) {
      const targetId = accountIdMap[accountId] ?? accountId;
      local.plaintext.entries[targetId] = { password: entry.password };
    }
    return resealWithKey(localEnvelope, local.key, local.plaintext);
  }

  async maybeAutoLock(): Promise<void> {
    await this.ensureLoaded();
    if (this.state !== 'unlocked') return;

    const settings = await readSettings();
    if (!shouldAutoLock(this.lastActivityAt, Date.now(), settings.autoLockMinutes)) return;

    await this.lock();
    log.info('vault-auto-locked');
  }

  private applyUnlocked(key: CryptoKey): void {
    this.key = key;
    this.state = 'unlocked';
    this.lastActivityAt = Date.now();
    this.loaded = true;
  }

  private async requireKey(): Promise<CryptoKey> {
    await this.ensureLoaded();
    if (this.state !== 'unlocked' || !this.key) throw new FlowError('E_VAULT_LOCKED');
    return this.key;
  }

  private async readEnvelope(): Promise<VaultEnvelope> {
    const envelope = parseVaultEnvelope(await readVaultRaw());
    if (!envelope) throw new FlowError('E_VAULT_NOT_INITIALIZED');
    return envelope;
  }
}

export const vaultService = new VaultService();
