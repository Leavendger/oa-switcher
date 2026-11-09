import { useEffect, useState } from 'react';
import { FLOW_TIMEOUTS, UI_KEEPALIVE_PORT } from '../shared/constants';
import { useBootstrap } from '../ui/useBootstrap';
import { applyTheme } from '../ui/theme';
import { AccountsSection } from './sections/AccountsSection';
import { DataTransferSection } from './sections/DataTransferSection';
import { GroupsSection } from './sections/GroupsSection';
import { SecuritySection } from './sections/SecuritySection';
import { SystemsSection } from './sections/SystemsSection';

type Tab = 'systems' | 'accounts' | 'groups' | 'security' | 'transfer';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'systems', label: 'OA 系统' },
  { id: 'accounts', label: '账号' },
  { id: 'groups', label: '分组' },
  { id: 'security', label: '安全与设置' },
  { id: 'transfer', label: '数据与迁移' },
];

export function App() {
  const { data, error, loading, reload } = useBootstrap();
  const [tab, setTab] = useState<Tab>('systems');

  useEffect(() => {
    applyTheme(data?.settings.theme ?? 'system');
  }, [data?.settings.theme]);

  useEffect(() => {
    /**
     * 配置期间保活后台：MV3 的 SW 空闲约 30 秒会被终止，内存中的保险库 CryptoKey
     * 随之丢失。用户在账号表单里填写稍久再保存，就会遇到「保险库已锁定」。
     * 这里用长连接 + 20 秒心跳让 SW 保持存活；端口消息不计入用户活动，不影响自动锁定。
     */
    let port: chrome.runtime.Port | null = null;
    const connect = () => {
      try {
        port = chrome.runtime.connect({ name: UI_KEEPALIVE_PORT });
        port.onDisconnect.addListener(() => {
          port = null;
        });
      } catch {
        port = null;
      }
    };
    connect();
    const timer = window.setInterval(() => {
      if (!port) {
        connect();
        return;
      }
      try {
        port.postMessage({ type: 'heartbeat', at: Date.now() });
      } catch {
        port = null;
      }
    }, FLOW_TIMEOUTS.keepaliveIntervalMs);

    return () => {
      window.clearInterval(timer);
      port?.disconnect();
      port = null;
    };
  }, []);

  // 页面重新可见时同步一次后台状态，避免保险库已锁定但界面仍显示已解锁
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void reload();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [reload]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-[18px] font-semibold">OA Switcher 设置</h1>
        <p className="mt-1 text-[12px] text-muted">
          配置 OA 系统、账号、分组，并管理本地加密保险库。
        </p>
      </header>

      <nav className="flex flex-wrap gap-1" aria-label="设置分区">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-oa px-3 py-1.5 text-[12px] ${
              tab === item.id
                ? 'bg-accent text-white'
                : 'border border-border bg-surface text-text hover:bg-bg'
            }`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      {loading ? <p className="text-[12px] text-muted">正在加载配置…</p> : null}

      {data ? (
        <main className="flex flex-col gap-4">
          {tab === 'systems' ? (
            <SystemsSection
              systems={data.systems}
              activeSystemId={data.settings.activeSystemId}
              reload={reload}
            />
          ) : null}
          {tab === 'accounts' ? (
            <AccountsSection
              accounts={data.accounts}
              systems={data.systems}
              groups={data.groups}
              vaultState={data.vault.state}
              reload={reload}
            />
          ) : null}
          {tab === 'groups' ? (
            <GroupsSection groups={data.groups} accounts={data.accounts} reload={reload} />
          ) : null}
          {tab === 'security' ? (
            <SecuritySection
              settings={data.settings}
              vaultState={data.vault.state}
              reload={reload}
            />
          ) : null}
          {tab === 'transfer' ? <DataTransferSection reload={reload} /> : null}
        </main>
      ) : null}
    </div>
  );
}
