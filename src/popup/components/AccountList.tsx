import { useState } from 'react';
import type { Account, AccountGroup } from '../../shared/types/account';
import type { AccountId } from '../../shared/types/ids';
import type { PopupGrouping } from '../../shared/types/settings';
import { Button } from '../../ui/Button';
import { inputClass } from '../../ui/Field';

function sortAccounts(items: Account[]): Account[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

function matches(account: Account, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    account.label.toLowerCase().includes(needle) ||
    account.username.toLowerCase().includes(needle) ||
    (account.role ?? '').toLowerCase().includes(needle)
  );
}

interface AccountRowProps {
  account: Account;
  selected: boolean;
  onSelect: (id: AccountId) => void;
}

function AccountRow({ account, selected, onSelect }: AccountRowProps) {
  return (
    <button
      type="button"
      disabled={!account.enabled}
      className={`flex w-full items-center justify-between rounded-oa border px-2 py-1.5 text-left transition-colors ${
        selected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg'
      } ${account.enabled ? '' : 'opacity-50'}`}
      onClick={() => onSelect(account.id)}
    >
      <span className="flex flex-col">
        <span className="text-[13px]">{account.label}</span>
        <span className="code text-[11px] text-muted">{account.username}</span>
      </span>
      <span className="flex items-center gap-1">
        {account.role ? <span className="text-[10px] text-muted">{account.role}</span> : null}
        {!account.enabled ? <span className="text-[10px] text-muted">已停用</span> : null}
      </span>
    </button>
  );
}

export interface AccountListProps {
  accounts: Account[];
  groups: AccountGroup[];
  grouping: PopupGrouping;
  selectedId: AccountId | null;
  onSelect: (id: AccountId) => void;
  onOpenOptions: () => void;
  /** 空状态文案：区分「该系统还没有账号」与「尚未配置任何账号」。 */
  emptyTitle?: string;
  emptyHint?: string;
}

export function AccountList({
  accounts,
  groups,
  grouping,
  selectedId,
  onSelect,
  onOpenOptions,
  emptyTitle = '还没有账号',
  emptyHint = '先在设置页添加 OA 账号，密码会存入加密保险库。',
}: AccountListProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (accounts.length === 0) {
    return (
      <div className="card p-4 text-center">
        <p className="text-[13px] font-medium">{emptyTitle}</p>
        <p className="mt-1 text-[11px] text-muted">{emptyHint}</p>
        <Button className="mt-2" onClick={onOpenOptions}>
          前往设置
        </Button>
      </div>
    );
  }

  const filtered = sortAccounts(accounts.filter((account) => matches(account, query.trim())));
  const sortedGroups = [...groups].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  const renderRows = (items: Account[]) =>
    items.map((account) => (
      <AccountRow
        key={account.id}
        account={account}
        selected={account.id === selectedId}
        onSelect={onSelect}
      />
    ));

  return (
    <div className="flex flex-col gap-2">
      <input
        className={inputClass}
        placeholder="搜索账号 / 用户名 / 角色"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="px-1 text-[11px] text-muted">没有匹配的账号</p>
      ) : grouping === 'flat' ? (
        <div className="card p-2">{renderRows(filtered)}</div>
      ) : (
        <>
          {sortedGroups.map((group) => {
            const items = filtered.filter((account) => account.groupId === group.id);
            if (items.length === 0) return null;
            const isCollapsed = collapsed[group.id] ?? group.collapsedByDefault;
            return (
              <div key={group.id} className="card p-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-1 pb-1 text-[11px] font-medium text-muted"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !isCollapsed }))}
                >
                  <span>{group.name}</span>
                  <span>{isCollapsed ? '展开' : '收起'}</span>
                </button>
                {isCollapsed ? null : renderRows(items)}
              </div>
            );
          })}

          {(() => {
            const ungrouped = filtered.filter(
              (account) => account.groupId === null || !groups.some((group) => group.id === account.groupId),
            );
            if (ungrouped.length === 0) return null;
            return (
              <div className="card p-2">
                <p className="px-1 pb-1 text-[11px] font-medium text-muted">未分组</p>
                {renderRows(ungrouped)}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
