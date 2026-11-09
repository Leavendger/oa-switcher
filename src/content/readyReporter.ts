import { createRequest } from '../shared/messaging/protocol';
import { frameRole } from './guards';

/** 页面就绪上报：只发送 origin 级 URL 与标题，绝不发送查询串。 */
export function reportReady(): void {
  let url = '';
  try {
    url = location.origin;
  } catch {
    url = '';
  }

  try {
    const envelope = createRequest('content.ready', {
      url,
      title: document.title,
      frame: frameRole(),
    });
    void chrome.runtime.sendMessage(envelope).catch(() => undefined);
  } catch {
    // 扩展被更新/卸载后上下文失效，忽略即可
  }
}
