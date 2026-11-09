import { useState } from 'react';
import { describeError } from '../../errors/messages.zh-CN';
import { GROUP_COLOR_KEYS } from '../../shared/constants';
import { callBackground } from '../../shared/messaging/client';
import type { Account, AccountGroup, GroupDraft } from '../../shared/types/account';
import type { GroupId } from '../../shared/types/ids';
import { Button } from '../../ui/Button';
import { Field, inputClass } from '../../ui/Field';
import { Modal } from '../../ui/Modal';

const COLOR_LABELS: Record<string, string> = {
  blue: '蓝色',
  green: '绿色',
  amber: '琥珀',
  rose: '玫红',
  violet: '紫色',
  slate: '石板灰',
};

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  rose: '#f43f5e',
  violet: '#8b5cf6',
  slate: '#64748b',
};

interface GroupFormState {
  id: GroupId | null;
  name: string;
  color: string;
  sortOrder: number;
  collapsedByDefault: boolean;
}

export interface GroupsSectionProps {
  groups: AccountGroup[];
  accounts: Account[];
  reload: () => Promise<void>;
}

export function GroupsSection({ groups, accounts, reload }: GroupsSectionProps) {
  const [form, setForm] = useState<GroupFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AccountGroup | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const openCreate = () => {
    setMessage(null);
    setForm({
      id: null,
      name: '',
      color: 'blue',
      sortOrder: groups.length,
      collapsedByDefault: false,
    });
  };

  const openEdit = (group: AccountGroup) => {
    setMessage(null);
    setForm({
      id: group.id,
      name: group.name,
      color: group.color ?? '',
      sortOrder: group.sortOrder,
      collapsedByDefault: group.collapsedByDefault,
    });
  };

  const handleSave = async () => {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const draft: GroupDraft = {
        name: form.name.trim(),
        color: form.color === '' ? null : form.color,
        sortOrder: Number.isFinite(form.sortOrder) ? Math.trunc(form.sortOrder) : 0,
        collapsedByDefault: form.collapsedByDefault,
      };

      if (form.id) {
        await callBackground('group.update', { id: form.id, patch: draft });
      } else {
        await callBackground('group.create', { draft });
      }
      setForm(null);
      setMessage('分组已保存');
      await reload();
    } catch (cause) {
      setMessage(describeError(cause));
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
      await callBackground('group.delete', { id: target.id });
      setMessage('分组已删除，原属该分组的账号已移到未分组');
      await reload();
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="card p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">账号分组</h2>
          <Button variant="primary" disabled={busy} onClick={openCreate}>
            新增分组
          </Button>
        </div>

        {message ? <p className="mt-2 text-[12px] text-muted">{message}</p> : null}

        {sorted.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted">还没有分组。分组仅用于 Popup 归类展示。</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {sorted.map((group) => (
              <li key={group.id} className="flex items-center justify-between rounded-oa border border-border p-2">
                <div className="flex items-center gap-2">
                  {group.color ? (
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: COLOR_HEX[group.color] ?? 'transparent' }}
                    />
                  ) : null}
                  <div>
                    <p className="text-[13px]">
                      {group.name}
                      {group.collapsedByDefault ? (
                        <span className="ml-1 text-[11px] text-muted">默认折叠</span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted">
                      排序 {group.sortOrder} · {accounts.filter((account) => account.groupId === group.id).length} 个账号
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button disabled={busy} onClick={() => openEdit(group)}>
                    编辑
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => setPendingDelete(group)}>
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={form !== null}
        title={form?.id ? '编辑分组' : '新增分组'}
        confirmLabel={busy ? '保存中…' : '保存'}
        confirmVariant="primary"
        onConfirm={() => void handleSave()}
        onClose={() => setForm(null)}
      >
        {form ? (
          <div className="flex flex-col gap-2">
            <Field label="分组名" htmlFor="group-name">
              <input
                id="group-name"
                className={inputClass}
                maxLength={24}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>

            <Field label="颜色" htmlFor="group-color">
              <select
                id="group-color"
                className={inputClass}
                value={form.color}
                onChange={(event) => setForm({ ...form, color: event.target.value })}
              >
                <option value="">无颜色</option>
                {GROUP_COLOR_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {COLOR_LABELS[key] ?? key}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="排序（越小越靠前）" htmlFor="group-sort">
              <input
                id="group-sort"
                className={inputClass}
                type="number"
                value={form.sortOrder}
                onChange={(event) =>
                  setForm({ ...form, sortOrder: event.target.value === '' ? 0 : Number(event.target.value) })
                }
              />
            </Field>

            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={form.collapsedByDefault}
                onChange={(event) => setForm({ ...form, collapsedByDefault: event.target.checked })}
              />
              Popup 中默认折叠
            </label>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        title="删除分组"
        confirmLabel="删除"
        onConfirm={() => void handleDelete()}
        onClose={() => setPendingDelete(null)}
      >
        确认删除「{pendingDelete?.name ?? ''}」？该分组下的账号会移到未分组，账号本身不会被删除。
      </Modal>
    </section>
  );
}
