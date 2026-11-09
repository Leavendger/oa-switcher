import { PORT_NAME, UI_KEEPALIVE_PORT, VAULT_AUTOLOCK_ALARM } from '../shared/constants';
import { log } from '../shared/log';
import { dispatchRequest, isExtensionSender } from '../shared/messaging/server';
import { ensureSchema } from '../storage/migrations';
import { reconcileContentScripts } from './contentRegistry';
import { flowRunner } from './flow/runner';
import { snapshotStore } from './flow/snapshotStore';
import { routes } from './router';
import { applyDebugFlag } from './services/settingsService';
import { vaultService } from './services/vaultService';
import { notifyVaultState } from './services/vaultNotifier';
import { trackUiKeepAlivePort } from './uiKeepAlive';

let initialized = false;
let initPromise: Promise<void> | null = null;

async function ensureVaultAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(VAULT_AUTOLOCK_ALARM);
  if (!existing) {
    chrome.alarms.create(VAULT_AUTOLOCK_ALARM, { periodInMinutes: 1 });
  }
}

async function initialize(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    await ensureSchema();
    await applyDebugFlag();
    await flowRunner.restore();
    // SW 冷启动后保险库只可能是 uninitialized / locked；密钥不落盘，天然重锁
    await vaultService.ensureLoaded();
    await ensureVaultAlarm();
    await reconcileContentScripts();
    // SW 冷启动后保险库必然是未初始化/锁定：广播一次，让已连接的 UI 立刻校正状态
    await notifyVaultState();
    log.info('background-ready');
  } catch (error) {
    log.error('initialize-failed', error);
  }
}

/**
 * 冷启动时 onMessage 监听器先于 initialize 就绪：若请求在 initialize 期间到达，
 * flowRunner.restore() 会把刚启动的流程误判为 service-worker-restart。
 * 所有请求统一等待同一个初始化 Promise，再分发。
 */
function ensureInitialized(): Promise<void> {
  initPromise ??= initialize();
  return initPromise;
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureInitialized();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureInitialized();
});

chrome.permissions.onAdded.addListener(() => {
  void reconcileContentScripts().catch((error: unknown) => log.error('reconcile-failed', error));
});

chrome.permissions.onRemoved.addListener(() => {
  void reconcileContentScripts().catch((error: unknown) => log.error('reconcile-failed', error));
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === UI_KEEPALIVE_PORT) {
    trackUiKeepAlivePort(port);
    return;
  }
  if (port.name !== PORT_NAME) return;
  snapshotStore.attach(port);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== VAULT_AUTOLOCK_ALARM) return;
  void vaultService
    .maybeAutoLock()
    .then(() => notifyVaultState())
    .catch((error: unknown) => log.error('vault-autolock-failed', error));
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (!isExtensionSender(sender)) return false;
    // 只有扩展页面（Popup/Options）的请求计入用户活动；页面脚本消息不刷新空闲计时
    if (!sender.tab) vaultService.touchActivity();
    void ensureInitialized()
      .then(() => dispatchRequest(message, routes, { sender }))
      .then((response) => {
        sendResponse(response);
      })
      .catch((error: unknown) => {
        log.error('dispatch-failed', error);
      });
    return true;
  },
);

void ensureInitialized();
