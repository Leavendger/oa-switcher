import type { AccountId, GroupId, SystemId } from './ids';

/** 账号元数据。密码不在此结构中，只存在于加密保险库。 */
export interface Account {
  id: AccountId;
  label: string;
  username: string;
  systemId: SystemId;
  groupId: GroupId | null;
  role: string | null;
  note: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 新建/编辑账号时提交的字段。password 仅用于写入保险库，不落 accounts。 */
export interface AccountDraft {
  label: string;
  username: string;
  systemId: SystemId;
  groupId: GroupId | null;
  role: string | null;
  note: string | null;
  enabled: boolean;
  sortOrder: number;
  password?: string;
}

export interface AccountGroup {
  id: GroupId;
  name: string;
  color: string | null;
  sortOrder: number;
  collapsedByDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GroupDraft {
  name: string;
  color: string | null;
  sortOrder: number;
  collapsedByDefault: boolean;
}
