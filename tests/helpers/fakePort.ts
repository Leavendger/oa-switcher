import { vi } from 'vitest';

type Listener = (value: unknown) => void;

export interface FakePort {
  port: chrome.runtime.Port;
  emitMessage: (value: unknown) => void;
  emitDisconnect: () => void;
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

/** 可手动触发消息/断线的 chrome.runtime.Port 假实现。 */
export function createFakePort(): FakePort {
  const messageListeners: Listener[] = [];
  const disconnectListeners: Listener[] = [];
  const disconnect = vi.fn();
  const postMessage = vi.fn();
  const port = {
    onMessage: { addListener: (fn: Listener) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: Listener) => disconnectListeners.push(fn) },
    postMessage,
    disconnect,
  };
  return {
    port: port as unknown as chrome.runtime.Port,
    emitMessage: (value: unknown) => {
      for (const fn of messageListeners) fn(value);
    },
    emitDisconnect: () => {
      for (const fn of disconnectListeners) fn(undefined);
    },
    postMessage,
    disconnect,
  };
}

/** 安装最小 chrome.runtime.connect 假实现，记录每次创建的端口。 */
export function installRuntimePortMock(): {
  connect: ReturnType<typeof vi.fn>;
  created: FakePort[];
} {
  const created: FakePort[] = [];
  const connect = vi.fn(() => {
    const fake = createFakePort();
    created.push(fake);
    return fake.port;
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test-extension', connect },
  };
  return { connect, created };
}
