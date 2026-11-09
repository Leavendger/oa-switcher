import { log } from '../shared/log';
import { handleContentRequest } from './bridge';
import { mountFloatingBall } from './floatBall';
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
    // 只在识别为已配置系统的页面渲染；不满足条件时模块内部直接返回、不创建节点
    void mountFloatingBall().catch((error: unknown) => {
      log.error('float-ball-mount-failed', error);
    });
  }

  log.info('content-ready', { frame: isTopFrame() ? 'top' : 'sub' });
}

const scope = globalThis as unknown as Record<string, unknown>;
if (!scope[INSTALL_FLAG]) {
  scope[INSTALL_FLAG] = true;
  install();
}
