import { useEffect, useState } from 'react';
import { describeError } from '../../errors/messages.zh-CN';
import { callBackground } from '../../shared/messaging/client';
import type { VaultState } from '../../shared/types/settings';
import { Button } from '../../ui/Button';
import { Field, inputClass } from '../../ui/Field';
import { Modal } from '../../ui/Modal';

const LABELS: Record<VaultState, string> = {
  uninitialized: '保险库未初始化',
  locked: '保险库已锁定',
  unlocked: '保险库已解锁',
};

export interface VaultGateProps {
  state: VaultState;
  /** 外部（如点击切换按钮）请求打开解锁/初始化弹窗；每次递增触发一次。 */
  unlockRequest?: number;
  onChanged: () => Promise<void> | void;
}

/** 主密码只在本地 state 中短暂存在：提交后立即清空，不写入任何 storage。 */
export function VaultGate({ state, unlockRequest = 0, onChanged }: VaultGateProps) {
  const [mode, setMode] = useState<'init' | 'unlock' | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (next: 'init' | 'unlock') => {
    setMode(next);
    setPassword('');
    setConfirm('');
    setError(null);
  };

  useEffect(() => {
    if (unlockRequest <= 0) return;
    setMode(state === 'uninitialized' ? 'init' : 'unlock');
    setPassword('');
    setConfirm('');
    setError(null);
    // 仅在外部请求变化时触发；state 只用于决定弹窗标题
  }, [unlockRequest]);

  const close = () => {
    setMode(null);
    setPassword('');
    setConfirm('');
    setError(null);
  };

  const submit = async () => {
    if (busy || !mode) return;
    if (mode === 'init' && password !== confirm) {
      setError('两次输入的主密码不一致');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'init') {
        await callBackground('vault.init', { masterPassword: password });
      } else {
        await callBackground('vault.unlock', { masterPassword: password });
      }
      await onChanged();
      setMode(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      // 无论成功失败，主密码不留在组件 state
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  };

  const handleLock = async () => {
    setBusy(true);
    setError(null);
    try {
      await callBackground('vault.lock', {});
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-oa border border-border bg-surface px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px]">{LABELS[state]}</p>
          <p className="text-[10px] text-muted">
            {state === 'unlocked'
              ? '密钥仅存于后台内存，浏览器重启后需重新解锁'
              : '主密码仅在后台内存派生密钥，不落盘'}
          </p>
        </div>
        {state === 'uninitialized' ? (
          <Button onClick={() => open('init')}>设置主密码</Button>
        ) : state === 'locked' ? (
          <Button onClick={() => open('unlock')}>解锁</Button>
        ) : (
          <Button disabled={busy} onClick={() => void handleLock()}>
            手动锁定
          </Button>
        )}
      </div>

      {error && mode === null ? <p className="mt-1 text-[11px] text-danger">{error}</p> : null}

      <Modal
        open={mode !== null}
        title={mode === 'init' ? '设置主密码' : '解锁保险库'}
        confirmLabel={busy ? '处理中…' : mode === 'init' ? '创建保险库' : '解锁'}
        confirmVariant="primary"
        onConfirm={() => void submit()}
        onClose={close}
      >
        <div className="flex flex-col gap-2">
          <Field
            label="主密码"
            htmlFor="vault-password"
            hint="至少 8 位。PBKDF2-SHA256 60 万次派生 + AES-GCM-256；密码本身不落盘。"
          >
            <input
              id="vault-password"
              className={inputClass}
              type="password"
              autoComplete={mode === 'init' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {mode === 'init' ? (
            <Field label="确认主密码" htmlFor="vault-password-confirm">
              <input
                id="vault-password-confirm"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
          ) : null}

          {error ? <p className="text-[11px] text-danger">{error}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
