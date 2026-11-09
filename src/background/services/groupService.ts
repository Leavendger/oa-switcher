import { GROUP_COLOR_KEYS, LIMITS } from '../../shared/constants';
import { FlowError } from '../../shared/types/errors';
import type { AccountGroup, GroupDraft } from '../../shared/types/account';
import type { GroupId } from '../../shared/types/ids';
import { newGroupId } from '../../shared/types/ids';
import {
  readAccounts,
  readGroups,
  writeAccountsAndGroups,
  writeGroups,
} from '../../storage/repo';

interface NormalizedGroupDraft {
  name: string;
  color: string | null;
  sortOrder: number;
  collapsedByDefault: boolean;
}

function normalizeDraft(draft: GroupDraft, groups: AccountGroup[], currentId: GroupId | null): NormalizedGroupDraft {
  if (typeof draft !== 'object' || draft === null) throw new FlowError('E_VALIDATION', { field: 'draft' });

  if (typeof draft.name !== 'string') throw new FlowError('E_VALIDATION', { field: 'name' });
  const name = draft.name.trim();
  if (name.length === 0 || name.length > LIMITS.groupName) {
    throw new FlowError('E_VALIDATION', { field: 'name' });
  }

  const duplicate = groups.some(
    (group) => group.id !== currentId && group.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) throw new FlowError('E_VALIDATION', { field: 'name' });

  let color: string | null = null;
  if (draft.color !== undefined && draft.color !== null) {
    if (typeof draft.color !== 'string') throw new FlowError('E_VALIDATION', { field: 'color' });
    if (!(GROUP_COLOR_KEYS as readonly string[]).includes(draft.color)) {
      throw new FlowError('E_VALIDATION', { field: 'color' });
    }
    color = draft.color;
  }

  if (!Number.isInteger(draft.sortOrder)) throw new FlowError('E_VALIDATION', { field: 'sortOrder' });
  if (typeof draft.collapsedByDefault !== 'boolean') {
    throw new FlowError('E_VALIDATION', { field: 'collapsedByDefault' });
  }

  return {
    name,
    color,
    sortOrder: draft.sortOrder,
    collapsedByDefault: draft.collapsedByDefault,
  };
}

export async function listGroups(): Promise<AccountGroup[]> {
  return readGroups();
}

export async function createGroup(draft: GroupDraft): Promise<AccountGroup> {
  const groups = await readGroups();
  const normalized = normalizeDraft(draft, groups, null);
  const now = Date.now();

  const group: AccountGroup = {
    id: newGroupId(),
    ...normalized,
    createdAt: now,
    updatedAt: now,
  };
  await writeGroups([...groups, group]);
  return group;
}

export async function updateGroup(id: GroupId, patch: Partial<GroupDraft>): Promise<AccountGroup> {
  const groups = await readGroups();
  const current = groups.find((group) => group.id === id);
  if (!current) throw new FlowError('E_VALIDATION', { field: 'id' });

  const merged: GroupDraft = {
    name: patch.name ?? current.name,
    color: patch.color === undefined ? current.color : patch.color,
    sortOrder: patch.sortOrder ?? current.sortOrder,
    collapsedByDefault: patch.collapsedByDefault ?? current.collapsedByDefault,
  };
  const normalized = normalizeDraft(merged, groups, id);
  const updated: AccountGroup = { ...current, ...normalized, updatedAt: Date.now() };

  await writeGroups(groups.map((group) => (group.id === id ? updated : group)));
  return updated;
}

/** 删除分组不级联删账号：同一次 storage.set 内把引用账号的 groupId 置 null。 */
export async function deleteGroup(id: GroupId): Promise<{ deleted: true }> {
  const [groups, accounts] = await Promise.all([readGroups(), readAccounts()]);
  if (!groups.some((group) => group.id === id)) {
    throw new FlowError('E_VALIDATION', { field: 'id' });
  }

  const now = Date.now();
  const nextAccounts = accounts.map((account) =>
    account.groupId === id ? { ...account, groupId: null, updatedAt: now } : account,
  );
  await writeAccountsAndGroups(nextAccounts, groups.filter((group) => group.id !== id));
  return { deleted: true };
}
