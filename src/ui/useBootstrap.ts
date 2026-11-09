import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../errors/messages.zh-CN';
import { callBackground } from '../shared/messaging/client';
import { FlowError } from '../shared/types/errors';
import type { AppBootstrapData } from '../shared/types/messages';

export function useBootstrap() {
  const [data, setData] = useState<AppBootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const next = await callBackground('app.bootstrap', {});
      setData(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof FlowError ? errorText(cause.code) : errorText(undefined));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /** 全量重载（会进入 loading 态）。 */
  const reload = useCallback(async () => {
    await load(false);
  }, [load]);

  /** 静默重拉：用于可见性变化 / 后台状态广播，避免按钮闪烁禁用。 */
  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Popup 可能长时间停留在打开状态：重新可见或重新聚焦时以后台为准，避免显示陈旧状态
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { data, error, loading, reload, refresh };
}
