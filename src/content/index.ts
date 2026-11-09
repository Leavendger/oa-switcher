import { log } from '../shared/log';
import { handleContentRequest } from './bridge';
import { startFloatingBall } from './floatBall';
import { isTopFrame } from './guards';
import { reportReady } from './readyReporter';

const INSTALL_FLAG = '__oaSwitcherContentInstalled';

function install(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (sender.id !== chrome.runtime.id) return false;
      void handleContentRequest(message, sender, isTopFrame())
        .then((response) => {
          sendResponse(response);
        })
        .catch((error: unknown) => {
          log.error('content-dispatch-failed', error);
        });
      return true;
    },
  );

  reportReady();

  if (isTopFrame()) {
    // 只在识别为已配置系统的页面渲染；开关或站点级隐藏变化时由管理器即时挂载/移除
    startFloatingBall();
  }

  log.info('content-ready', { frame: isTopFrame() ? 'top' : 'sub' });
}

const scope = globalThis as unknown as Record<string, unknown>;
if (!scope[INSTALL_FLAG]) {
  scope[INSTALL_FLAG] = true;
  install();
}
