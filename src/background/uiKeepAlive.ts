/**
 * Options 页常开时的 Service Worker 保活。
 *
 * MV3 的 Service Worker 在约 30 秒无事件后会被 Chrome 终止，后台内存中的
 * 保险库 CryptoKey 会随之丢失，状态变为 locked。用户刚创建保险库、在账号表单里
 * 填写超过 30 秒再保存时就会遇到「保险库已锁定」。
 *
 * 这里只持有 UI 侧的长连接（并在 UI 侧每 20 秒发一次心跳），让 SW 在
 * 配置期间保持存活；端口消息不计入用户活动，自动锁定计时不受影响。
 */

const trackedPorts = new Set<chrome.runtime.Port>();

export function trackUiKeepAlivePort(port: chrome.runtime.Port): void {
  trackedPorts.add(port);
  port.onDisconnect.addListener(() => {
    trackedPorts.delete(port);
  });
}

/** 仅用于单测/诊断：当前被保活的 UI 连接数量。 */
export function trackedUiKeepAlivePortCount(): number {
  return trackedPorts.size;
}
