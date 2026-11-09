import { LIMITS } from '../../shared/constants';
import { log } from '../../shared/log';
import { FlowError, isFlowError } from '../../shared/types/errors';
import type { Account, AccountDraft } from '../../shared/types/account';
import type { AccountId, GroupId, SystemId } from '../../shared/types/ids';
import { newAccountId } from '../../shared/types/ids';
import { readAccounts, readGroups, readSystems, writeAccounts } from '../../storage/repo';
import { vaultService } from './vaultService';

interface NormalizedAccountDraft {
  label: string;
  username: string;
  systemId: SystemId;
  groupId: GroupId | null;
  role: string | null;
  note: string | null;
  enabled: boolean;
  sortOrder: number;
}

function optionalText(value: unknown, limit: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new FlowError('E_VALIDATION', { field });
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > limit) throw new FlowError('E_VALIDATION', { field });
  return trimmed;
}

function requiredText(value: unknown, limit: number, field: string): string {
  if (typeof value !== 'string') throw new FlowError('E_VALIDATION', { field });
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > limit) throw new FlowError('E_VALIDATION', { field });
  return trimmed;
}

function optionalPassword(draft: AccountDraft): string | null {
  if (draft.password === undefined || draft.password === null) return null;
  if (typeof draft.password !== 'string') throw new FlowError('E_VALIDATION', { field: 'password' });
  if (draft.password.length === 0) return null;
  if (draft.password.length > LIMITS.accountPassword) {
    throw new FlowError('E_VALIDATION', { field: 'password' });
  }
  return draft.password;
}

async function normalizeDraft(
  draft: AccountDraft,
  accounts: Account[],
  currentId: AccountId | null,
): Promise<NormalizedAccountDraft> {
  if (typeof draft !== 'object' || draft === null) throw new FlowError('E_VALIDATION', { field: 'draft' });

  const label = requiredText(draft.label, LIMITS.accountLabel, 'label');
  const username = requiredText(draft.username, LIMITS.username, 'username');

  const systems = await readSystems();
  if (typeof draft.systemId !== 'string' || !systems.some((system) => system.id === draft.systemId)) {
    throw new FlowError('E_VALIDATION', { field: 'systemId' });
  }
  const systemId = draft.systemId as SystemId;

  const groups = await readGroups();
  let groupId: GroupId | null = null;
  if (draft.groupId !== undefined && draft.groupId !== null) {
    if (typeof draft.groupId !== 'string' || !groups.some((group) => group.id === draft.groupId)) {
      throw new FlowError('E_VALIDATION', { field: 'groupId' });
    }
    groupId = draft.groupId as GroupId;
  }

  const role = optionalText(draft.role, LIMITS.accountRole, 'role');
  const note = optionalText(draft.note, LIMITS.accountNote, 'note');

  if (typeof draft.enabled !== 'boolean') throw new FlowError('E_VALIDATION', { field: 'enabled' });
  if (!Number.isInteger(draft.sortOrder)) throw new FlowError('E_VALIDATION', { field: 'sortOrder' });

  const duplicate = accounts.some(
    (account) =>
      account.id !== currentId &&
      account.systemId === systemId &&
      account.username === username,
  );
  if (duplicate) throw new FlowError('E_VALIDATION', { field: 'username' });

  return {
    label,
    username,
    systemId,
    groupId,
    role,
    note,
    enabled: draft.enabled,
    sortOrder: draft.sortOrder,
  };
}

export async function listAccounts(): Promise<Account[]> {
  return readAccounts();
}

export async function createAccount(draft: AccountDraft): Promise<Account> {
  const accounts = await readAccounts();
  const normalized = await normalizeDraft(draft, accounts, null);
  const password = optionalPassword(draft);

  const now = Date.now();
  const account: Account = {
    id: newAccountId(),
    ...normalized,
    createdAt: now,
    updatedAt: now,
  };

  if (password === null) {
    await writeAccounts([...accounts, account]);
    return account;
  }

  // 密码类变更：先写密文，成功后再写元数据；元数据失败则回滚保险库条目
  await vaultService.writePassword(account.id, password);
  try {
    await writeAccounts([...accounts, account]);
  } catch (error) {
    await vaultService.removePassword(account.id).catch(() => undefined);
    log.error('account-create-write-failed', error, { accountId: account.id });
    throw new FlowError('E_INTERNAL', { reason: 'account-write-failed' });
  }
  return account;
}

export async function updateAccount(id: AccountId, draft: AccountDraft): Promise<Account> {
  const accounts = await readAccounts();
  const current = accounts.find((account) => account.id === id);
  if (!current) throw new FlowError('E_VALIDATION', { field: 'id' });

  const normalized = await normalizeDraft(draft, accounts, id);
  const password = optionalPassword(draft);
  const updated: Account = { ...current, ...normalized, updatedAt: Date.now() };

  if (password === null) {
    // 元数据变更不触碰密文，也不要求解锁
    await writeAccounts(accounts.map((account) => (account.id === id ? updated : account)));
    return updated;
  }

  const previous = await readExistingPassword(id);
  await vaultService.writePassword(id, password);
  try {
    await writeAccounts(accounts.map((account) => (account.id === id ? updated : account)));
  } catch (error) {
    await restorePassword(id, previous);
    log.error('account-update-write-failed', error, { accountId: id });
    throw new FlowError('E_INTERNAL', { reason: 'account-write-failed' });
  }
  return updated;
}

/**
 * 删除元数据后尽力清理保险库孤儿条目：
 * 已解锁才移除密文；锁定/未初始化时不强行解密，保留条目以保证元数据删除不受阻。
 */
export async function deleteAccount(
  id: AccountId,
): Promise<{ deleted: true; credentialRemoved: boolean }> {
  const accounts = await readAccounts();
  if (!accounts.some((account) => account.id === id)) {
    throw new FlowError('E_VALIDATION', { field: 'id' });
  }
  await writeAccounts(accounts.filter((account) => account.id !== id));

  let credentialRemoved = false;
  try {
    const { state } = await vaultService.status();
    if (state === 'unlocked') {
      await vaultService.removePassword(id);
      credentialRemoved = true;
    }
  } catch {
    log.warn('account-credential-cleanup-failed', { accountId: id });
  }

  return { deleted: true, credentialRemoved };
}

async function readExistingPassword(id: AccountId): Promise<string | null> {
  try {
    return await vaultService.readPassword(id);
  } catch (error) {
    if (isFlowError(error) && error.code === 'E_CREDENTIAL_MISSING') return null;
    throw error;
  }
}

async function restorePassword(id: AccountId, previous: string | null): Promise<void> {
  try {
    if (previous === null) {
      await vaultService.removePassword(id);
    } else {
      await vaultService.writePassword(id, previous);
    }
  } catch {
    log.warn('account-password-rollback-failed', { accountId: id });
  }
}
