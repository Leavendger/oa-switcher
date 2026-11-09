import { useState } from 'react';
import { describeError } from '../../errors/messages.zh-CN';
import { callBackground } from '../../shared/messaging/client';
import type { Account, AccountDraft, AccountGroup } from '../../shared/types/account';
import type { AccountId, GroupId, SystemId } from '../../shared/types/ids';
import type { OASystem } from '../../shared/types/system';
import type { VaultState } from '../../shared/types/settings';
import { Button } from '../../ui/Button';
import { Field, inputClass } from '../../ui/Field';
import { Modal } from '../../ui/Modal';

interface AccountFormState {
  id: AccountId | null;
  label: string;
  username: string;
  systemId: string;
  groupId: string;
  role: string;
  note: string;
  enabled: boolean;
  sortOrder: number;
  password: string;
}

export interface AccountsSectionProps {
  accounts: Account[];
  systems: OASystem[];
  groups: AccountGroup[];
  vaultState: VaultState;
  reload: () => Promise<void>;
}

function emptyForm(systems: OASystem[], accounts: Account[]): AccountFormState {
  return {
    id: null,
    label: '',
    username: '',
    systemId: systems[0]?.id ?? '',
    groupId: '',
    role: '',
    note: '',
    enabled: true,
    sortOrder: accounts.length,
    password: '',
  };
}

export function AccountsSection({
  accounts,
  systems,
  groups,
  vaultState,
  reload,
}: AccountsSectionProps) {
  const [form, setForm] = useState<AccountFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const [filterSystem, setFilterSystem] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');

  const unlocked = vaultState === 'unlocked';

  const openCreate = () => {
    setMessage(null);
    setForm(emptyForm(systems, accounts));
  };

  const openEdit = (account: Account) => {
    setMessage(null);
    setForm({
      id: account.id,
      label: account.label,
      username: account.username,
      systemId: account.systemId,
      groupId: account.groupId ?? '',
      role: account.role ?? '',
      note: account.note ?? '',
      enabled: account.enabled,
      sortOrder: account.sortOrder,
      password: '',
    });
  };

  const handleSave = async () => {
    if (!form) return;
    if (!form.systemId) {
      setMessage('请先添加一个 OA 系统');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const draft: AccountDraft = {
        label: form.label.trim(),
        username: form.username.trim(),
        systemId: form.systemId as SystemId,
        groupId: form.groupId === '' ? null : (form.groupId as GroupId),
        role: form.role.trim() === '' ? null : form.role.trim(),
        note: form.note.trim() === '' ? null : form.note.trim(),
        enabled: form.enabled,
        sortOrder: Number.isFinite(form.sortOrder) ? Math.trunc(form.sortOrder) : 0,
        password: form.password === '' ? undefined : form.password,
      };

      if (form.id) {
        await callBackground('account.update', { id: form.id, draft });
      } else {
        await callBackground('account.create', { draft });
      }
      setForm(null);
      setMessage('账号已保存');
      await reload();
    } catch (cause) {
      setMessage(describeError(cause));
      // 失败时同步后台状态：例如保险库在请求前被锁定，界面不应继续显示「已解锁」
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    setMessage(null);
    try {
      await callBackground('account.delete', { id: target.id });
      setMessage('账号元数据已删除（保险库中的密文条目不会因元数据变更而重写）');
      await reload();
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await callBackground('vault.unlock', { masterPassword: unlockPassword });
      setUnlockPassword('');
      await reload();
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const filtered = filterSystem
    ? accounts.filter((account) => account.systemId === filterSystem)
    : accounts;

  return (
    <section className="flex flex-col gap-3">
      {!unlocked ? (
        <div className="card p-3">
          <h2 className="text-[14px] font-semibold">保险库</h2>
          {vaultState === 'uninitialized' ? (
            <p className="mt-1 text-[12px] text-muted">
              保险库尚未初始化。请到「安全与设置」分区设置主密码后再保存账号密码。
            </p>
          ) : (
            <>
              <p className="mt-1 text-[12px] text-muted">
                已锁定。解锁后才能新增或修改密码；仅修改账号元数据不需要解锁。
              </p>
              <div className="mt-2 flex items-end gap-2">
                <Field label="主密码" htmlFor="accounts-unlock">
                  <input
                    id="accounts-unlock"
                    className={inputClass}
                    type="password"
                    autoComplete="current-password"
                    value={unlockPassword}
                    onChange={(event) => setUnlockPassword(event.target.value)}
                  />
                </Field>
                <Button variant="primary" disabled={busy} onClick={() => void handleUnlock()}>
                  解锁
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">账号</h2>
          <div className="flex items-center gap-2">
            <select
              className={inputClass}
              value={filterSystem}
              onChange={(event) => setFilterSystem(event.target.value)}
              aria-label="按系统筛选"
            >
              <option value="">全部系统</option>
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
            <Button variant="primary" disabled={busy || systems.length === 0} onClick={openCreate}>
              新增账号
            </Button>
          </div>
        </div>

        {message ? <p className="mt-2 text-[12px] text-muted">{message}</p> : null}

        {filtered.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted">还没有账号。</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {filtered.map((account) => {
              const system = systems.find((item) => item.id === account.systemId);
              const group = groups.find((item) => item.id === account.groupId);
              return (
                <li key={account.id} className="rounded-oa border border-border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-medium">
                        {account.label}
                        {!account.enabled ? (
                          <span className="ml-1 text-[11px] text-muted">已停用</span>
                        ) : null}
                      </p>
                      <p className="code text-[11px] text-muted">
                        {system?.name ?? account.systemId} · {account.username}
                        {group ? ` · ${group.name}` : ''}
                        {account.role ? ` · ${account.role}` : ''}
                      </p>
                      {account.note ? (
                        <p className="text-[11px] text-muted">{account.note}</p>
                      ) : null}
                    </div>
                    <div className="flex gap-1">
                      <Button disabled={busy} onClick={() => openEdit(account)}>
                        编辑
                      </Button>
                      <Button variant="danger" disabled={busy} onClick={() => setPendingDelete(account)}>
                        删除
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        open={form !== null}
        title={form?.id ? '编辑账号' : '新增账号'}
        confirmLabel={busy ? '保存中…' : '保存'}
        confirmVariant="primary"
        onConfirm={() => void handleSave()}
        onClose={() => setForm(null)}
      >
        {form ? (
          <div className="flex flex-col gap-2">
            <Field label="展示名" htmlFor="account-label">
              <input
                id="account-label"
                className={inputClass}
                maxLength={32}
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
              />
            </Field>

            <Field label="用户名" htmlFor="account-username">
              <input
                id="account-username"
                className={inputClass}
                maxLength={128}
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </Field>

            <Field label="OA 系统" htmlFor="account-system">
              <select
                id="account-system"
                className={inputClass}
                value={form.systemId}
                onChange={(event) => setForm({ ...form, systemId: event.target.value })}
              >
                {systems.map((system) => (
                  <option key={system.id} value={system.id}>
                    {system.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="分组" htmlFor="account-group">
              <select
                id="account-group"
                className={inputClass}
                value={form.groupId}
                onChange={(event) => setForm({ ...form, groupId: event.target.value })}
              >
                <option value="">未分组</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="角色（可选）" htmlFor="account-role">
              <input
                id="account-role"
                className={inputClass}
                maxLength={32}
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
              />
            </Field>

            <Field label="备注（可选）" htmlFor="account-note">
              <input
                id="account-note"
                className={inputClass}
                maxLength={120}
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
              />
            </Field>

            <Field label="排序（越小越靠前）" htmlFor="account-sort">
              <input
                id="account-sort"
                className={inputClass}
                type="number"
                value={form.sortOrder}
                onChange={(event) =>
                  setForm({ ...form, sortOrder: event.target.value === '' ? 0 : Number(event.target.value) })
                }
              />
            </Field>

            <Field
              label="密码"
              htmlFor="account-password"
              hint={
                unlocked
                  ? '留空表示不修改。密码会整库重新加密写入保险库，不落明文。'
                  : '保险库未解锁，密码字段不可编辑；仍可保存账号元数据。'
              }
            >
              <input
                id="account-password"
                className={inputClass}
                type="password"
                autoComplete="off"
                disabled={!unlocked}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </Field>

            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              启用（停用后不可切换）
            </label>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        title="删除账号"
        confirmLabel="删除"
        onConfirm={() => void handleDelete()}
        onClose={() => setPendingDelete(null)}
      >
        确认删除「{pendingDelete?.label ?? ''}」的账号元数据？保险库中的密码条目不会因元数据删除而改写。
      </Modal>
    </section>
  );
}
