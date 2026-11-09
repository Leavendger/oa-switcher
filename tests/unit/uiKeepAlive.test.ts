// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  trackUiKeepAlivePort,
  trackedUiKeepAlivePortCount,
} from '../../src/background/uiKeepAlive';

function fakePort(): { port: chrome.runtime.Port; disconnect: () => void } {
  const listeners: (() => void)[] = [];
  const port = {
    name: 'oa-switcher:ui',
    onDisconnect: {
      addListener: (callback: () => void) => {
        listeners.push(callback);
      },
      removeListener: () => undefined,
      hasListener: () => false,
    },
    disconnect: () => undefined,
    postMessage: () => undefined,
  } as unknown as chrome.runtime.Port;
  return {
    port,
    disconnect: () => {
      listeners.splice(0).forEach((callback) => callback());
    },
  };
}

describe('trackUiKeepAlivePort', () => {
  it('寄存器在连接断开时被移除', () => {
    const before = trackedUiKeepAlivePortCount();
    const { port, disconnect } = fakePort();

    trackUiKeepAlivePort(port);
    expect(trackedUiKeepAlivePortCount()).toBe(before + 1);

    disconnect();
    expect(trackedUiKeepAlivePortCount()).toBe(before);
  });

  it('多个 UI 连接各自独立计数', () => {
    const before = trackedUiKeepAlivePortCount();
    const first = fakePort();
    const second = fakePort();

    trackUiKeepAlivePort(first.port);
    trackUiKeepAlivePort(second.port);
    expect(trackedUiKeepAlivePortCount()).toBe(before + 2);

    first.disconnect();
    expect(trackedUiKeepAlivePortCount()).toBe(before + 1);

    second.disconnect();
    expect(trackedUiKeepAlivePortCount()).toBe(before);
  });
});
