import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../../errors/messages.zh-CN';
import { FLOAT_STORAGE_KEYS } from '../../shared/constants';
import { callBackground } from '../../shared/messaging/client';
import type { FloatPrefs } from '../../shared/types/ui';
import { Button } from '../../ui/Button';

export interface FloatBallSettingsProps {
  /** 当前活动标签页的 origin；不属于任何已配置系统时为 null。 */
  siteOrigin: string | null;
}

/**
 * 悬浮球显示设置。
 * 全局开关与站点级隐藏都写同一组存储键（float.enabled / float.dismissed），
 * 内容脚本监听变更后即时挂载或移除，无需刷新页面。
 */
export function FloatBallSettings({ siteOrigin }: FloatBallSettingsProps) {
  const [prefs, setPrefs] = useState<FloatPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPrefs(await callBackground('ui.getFloatPrefs', {}));
      setMessage(null);
    } catch (cause) {
      setMessage(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (FLOAT_STORAGE_KEYS.enabled in changes || FLOAT_STORAGE_KEYS.dismissed in changes) {
        void load();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const dismissedSites = prefs ? Object.keys(prefs.dismissed) : [];
  const siteDismissed = siteOrigin !== null && dismissedSites.includes(siteOrigin);

  return (
    <section className="rounded-oa border border-border px-2.5 py-2" aria-label="页面悬浮球设置">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">页面悬浮球</span>
        <label className="flex items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={prefs?.enabled ?? true}
            disabled={busy || prefs === null}
            onChange={(event) =>
              void run(() =>
                callBackground('ui.setFloatEnabled', { enabled: event.target.checked }),
              )
            }
          />
          显示
        </label>
      </div>

      <p className="mt-1 text-[10px] text-muted">
        仅在已配置的 OA 页面出现；开关立即生效，无需刷新页面。
      </p>

      {siteOrigin ? (
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={siteDismissed}
            disabled={busy || prefs === null}
            onChange={(event) =>
              void run(() =>
                event.target.checked
                  ? callBackground('ui.dismissFloat', { origin: siteOrigin })
                  : callBackground('ui.restoreFloatSite', { origin: siteOrigin }),
              )
            }
          />
          在当前站点隐藏（{siteOrigin}）
        </label>
      ) : null}

      {dismissedSites.length > 0 ? (
        <div className="mt-1.5">
          <p className="text-[10px] text-muted">已关闭的站点</p>
          <ul className="mt-1 flex flex-col gap-1">
            {dismissedSites.map((origin) => (
              <li key={origin} className="flex items-center justify-between gap-2">
                <span className="code text-[10px]">{origin}</span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() => callBackground('ui.restoreFloatSite', { origin }))
                  }
                >
                  恢复显示
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message ? <p className="mt-1 text-[11px] text-danger">{message}</p> : null}
    </section>
  );
}
