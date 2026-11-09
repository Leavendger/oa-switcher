import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../errors/messages.zh-CN';
import { callBackground, connectFlowPort } from '../shared/messaging/client';
import type { FlowStateSnapshot } from '../shared/types/flow';
import type { ActiveTabResolution } from '../shared/types/system';

/**
 * 订阅流程快照与保险库状态：端口推送 + 打开时主动拉取一次（防止错过迁移）。
 * 端口断开（SW 回收）或收到保险库广播时回调 onResync，由调用方重拉权威状态。
 */
export function useFlowPort(onResync?: () => void): FlowStateSnapshot | null {
  const [snapshot, setSnapshot] = useState<FlowStateSnapshot | null>(null);

  useEffect(() => {
    let alive = true;

    const pull = () => {
      void callBackground('flow.getState', {})
        .then((value) => {
          if (alive) setSnapshot(value);
        })
        .catch(() => undefined);
    };

    const disconnect = connectFlowPort({
      onSnapshot: (next) => {
        if (alive) setSnapshot(next);
      },
      onVaultState: () => {
        if (alive) onResync?.();
      },
      onReconnect: () => {
        if (!alive) return;
        pull();
        onResync?.();
      },
    });

    pull();

    return () => {
      alive = false;
      disconnect();
    };
  }, [onResync]);

  return snapshot;
}

/**
 * 解析当前活动标签页所属系统。
 * Popup 不跟随 tab 切换事件（Popup 打开期间页面不会变），但重新聚焦/可见时刷新，
 * 保证从设置页切回后结论是最新的。
 */
export function useActiveTabResolution(): {
  resolution: ActiveTabResolution | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [resolution, setResolution] = useState<ActiveTabResolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setResolution(await callBackground('system.resolveActiveTab', {}));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onFocus = () => {
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return { resolution, error, refresh };
}
