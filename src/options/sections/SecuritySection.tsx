import { useEffect, useState } from 'react';
import { describeError } from '../../errors/messages.zh-CN';
import { callBackground } from '../../shared/messaging/client';
import type { PopupGrouping, Settings, ThemePreference, VaultState } from '../../shared/types/settings';
import { Button } from '../../ui/Button';
import { Field, inputClass } from '../../ui/Field';
import { applyTheme } from '../../ui/theme';

export interface SecuritySectionProps {
  settings: Settings;
  vaultState: VaultState;
  reload: () => Promise<void>;
}

export function SecuritySection({ settings, vaultState, reload }: SecuritySectionProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [message, setMessage] = useState<string | null>(null);
  const [vaultMessage, setVaultMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [masterPassword, setMasterPassword] = useState('');
  const [masterConfirm, setMasterConfirm] = useState('');
  const [currentMaster, setCurrentMaster] = useState('');
  const [nextMaster, setNextMaster] = useState('');
  const [nextConfirm, setNextConfirm] = useState('');

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleTheme = (theme: ThemePreference) => {
    setDraft((prev) => ({ ...prev, theme }));
    applyTheme(theme);
  };

  const handleSave = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await callBackground('settings.update', { patch: draft });
      await reload();
      setMessage('设置已保存');
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const clearMasterInputs = () => {
    setMasterPassword('');
    setMasterConfirm('');
    setCurrentMaster('');
    setNextMaster('');
    setNextConfirm('');
  };

  const handleInit = async () => {
    if (masterPassword !== masterConfirm) {
      setVaultMessage('两次输入的主密码不一致');
      return;
    }
    setBusy(true);
    setVaultMessage(null);
    try {
      await callBackground('vault.init', { masterPassword });
      await reload();
      setVaultMessage('保险库已创建并解锁');
    } catch (cause) {
      setVaultMessage(describeError(cause));
    } finally {
      clearMasterInputs();
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    setVaultMessage(null);
    try {
      await callBackground('vault.unlock', { masterPassword });
      await reload();
      setVaultMessage('保险库已解锁');
    } catch (cause) {
      setVaultMessage(describeError(cause));
    } finally {
      clearMasterInputs();
      setBusy(false);
    }
  };

  const handleLock = async () => {
    setBusy(true);
    setVaultMessage(null);
    try {
      await callBackground('vault.lock', {});
      await reload();
      setVaultMessage('保险库已锁定');
    } catch (cause) {
      setVaultMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleChangeMaster = async () => {
    if (nextMaster !== nextConfirm) {
      setVaultMessage('两次输入的新主密码不一致');
      return;
    }
    setBusy(true);
    setVaultMessage(null);
    try {
      await callBackground('vault.changeMaster', { current: currentMaster, next: nextMaster });
      await reload();
      setVaultMessage('主密码已修改，保险库已用新密钥重新加密');
    } catch (cause) {
      setVaultMessage(describeError(cause));
    } finally {
      clearMasterInputs();
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="card p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">保险库</h2>
          <span className="text-[11px] text-muted">
            {vaultState === 'uninitialized'
              ? '未初始化'
              : vaultState === 'locked'
                ? '已锁定'
                : '已解锁'}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          PBKDF2-SHA256 60 万次派生 + AES-GCM-256 整库单密文；CryptoKey 不可导出，仅存于后台
          Service Worker 内存，浏览器重启后自动需要重新解锁。
        </p>

        {vaultMessage ? <p className="mt-2 text-[12px] text-muted">{vaultMessage}</p> : null}

        {vaultState === 'uninitialized' ? (
          <div className="mt-2 flex flex-col gap-2">
            <Field
              label="主密码"
              htmlFor="vault-init-password"
              hint="至少 8 位。密码不落盘，丢失后只能清空扩展数据重建保险库。"
            >
              <input
                id="vault-init-password"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={masterPassword}
                onChange={(event) => setMasterPassword(event.target.value)}
              />
            </Field>
            <Field label="确认主密码" htmlFor="vault-init-confirm">
              <input
                id="vault-init-confirm"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={masterConfirm}
                onChange={(event) => setMasterConfirm(event.target.value)}
              />
            </Field>
            <Button variant="primary" disabled={busy} onClick={() => void handleInit()}>
              创建保险库
            </Button>
          </div>
        ) : vaultState === 'locked' ? (
          <div className="mt-2 flex items-end gap-2">
            <Field label="主密码" htmlFor="vault-unlock-password">
              <input
                id="vault-unlock-password"
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={masterPassword}
                onChange={(event) => setMasterPassword(event.target.value)}
              />
            </Field>
            <Button variant="primary" disabled={busy} onClick={() => void handleUnlock()}>
              解锁
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <div>
              <Button disabled={busy} onClick={() => void handleLock()}>
                手动锁定
              </Button>
            </div>
            <h3 className="text-[13px] font-medium">修改主密码</h3>
            <Field label="当前主密码" htmlFor="vault-current-password">
              <input
                id="vault-current-password"
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={currentMaster}
                onChange={(event) => setCurrentMaster(event.target.value)}
              />
            </Field>
            <Field label="新主密码" htmlFor="vault-next-password">
              <input
                id="vault-next-password"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={nextMaster}
                onChange={(event) => setNextMaster(event.target.value)}
              />
            </Field>
            <Field label="确认新主密码" htmlFor="vault-next-confirm">
              <input
                id="vault-next-confirm"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={nextConfirm}
                onChange={(event) => setNextConfirm(event.target.value)}
              />
            </Field>
            <Button variant="primary" disabled={busy} onClick={() => void handleChangeMaster()}>
              修改主密码
            </Button>
          </div>
        )}
      </div>

      <div className="card p-3">
        <h2 className="text-[14px] font-semibold">基础设置</h2>
        <div className="mt-2 grid gap-2">
          <Field label="主题" htmlFor="settings-theme">
            <select
              id="settings-theme"
              className={inputClass}
              value={draft.theme}
              onChange={(event) => handleTheme(event.target.value as ThemePreference)}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </Field>

          <Field label="自动锁定（分钟）" htmlFor="settings-autolock" hint="0 表示不自动锁定。">
            <input
              id="settings-autolock"
              type="number"
              min={0}
              max={120}
              className={inputClass}
              value={draft.autoLockMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  autoLockMinutes: event.target.value === '' ? 0 : Number(event.target.value),
                }))
              }
            />
          </Field>

          <Field label="Popup 账号展示" htmlFor="settings-grouping">
            <select
              id="settings-grouping"
              className={inputClass}
              value={draft.preferredPopupGrouping}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  preferredPopupGrouping: event.target.value as PopupGrouping,
                }))
              }
            >
              <option value="grouped">按分组</option>
              <option value="flat">平铺</option>
            </select>
          </Field>

          {(
            [
              ['lockOnBrowserStart', '浏览器启动时锁定保险库（密钥本就不落盘，重启必然重锁）'],
              ['lockAfterSwitch', '切换完成后自动锁定保险库'],
              ['confirmBeforeSwitch', '切换前二次确认'],
              ['auditEnabled', '记录切换审计日志'],
              ['debugLogging', '输出调试日志（不包含密码/Cookie/Token）'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, [key]: event.target.checked }))
                }
              />
              {label}
            </label>
          ))}

          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void handleSave()}>
              保存设置
            </Button>
            {message ? <span className="text-[12px] text-muted">{message}</span> : null}
          </div>
        </div>
      </div>

      <div className="card p-3">
        <h2 className="text-[14px] font-semibold">安全边界</h2>
        <ul className="mt-1 list-disc pl-5 text-[12px] text-muted">
          <li>密码只以整库密文形式存在 chrome.storage.local，元数据与密文分离。</li>
          <li>主密码与派生密钥不落盘；CryptoKey 不可导出，仅存于后台内存。</li>
          <li>账号元数据的增删改不触碰密文，只有密码变更才解锁后整库重写。</li>
          <li>不写死蓝凌 OA 的选择器、退出地址或登录成功规则。</li>
          <li>页面脚本只在用户配置并通过授权申请的域名上注入。</li>
          <li>日志不记录密码、Cookie、Token 或带查询串的完整 URL。</li>
        </ul>
      </div>
    </section>
  );
}
