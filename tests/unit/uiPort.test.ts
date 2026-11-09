// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotStore } from '../../src/background/flow/snapshotStore';
import { connectFlowPort } from '../../src/shared/messaging/client';
import { createFakePort, installRuntimePortMock } from '../helpers/fakePort';

describe('connectFlowPort', () => {
  let runtime: ReturnType<typeof installRuntimePortMock>;

  beforeEach(() => {
    runtime = installRuntimePortMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('收到 vault.state 广播时回调 onVaultState（UI 据此重拉权威状态）', () => {
    const onVaultState = vi.fn();
    connectFlowPort({ onVaultState });

    runtime.created[0]?.emitMessage({ kind: 'evt', type: 'vault.state', state: 'locked' });

    expect(onVaultState).toHaveBeenCalledWith('locked');
  });

  it('忽略非法 vault.state 值与其他事件', () => {
    const onVaultState = vi.fn();
    connectFlowPort({ onVaultState });

    runtime.created[0]?.emitMessage({ kind: 'evt', type: 'vault.state', state: 'whatever' });
    runtime.created[0]?.emitMessage({ kind: 'evt', type: 'other' });

    expect(onVaultState).not.toHaveBeenCalled();
  });

  it('端口断开后先回调 onReconnect，再自动重连并再次回调', () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    connectFlowPort({ onReconnect });
    expect(runtime.connect).toHaveBeenCalledTimes(1);

    runtime.created[0]?.emitDisconnect();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(runtime.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(runtime.connect).toHaveBeenCalledTimes(2);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it('取消订阅后断开不再重连', () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const disconnect = connectFlowPort({ onReconnect });

    disconnect();
    runtime.created[0]?.emitDisconnect();
    vi.advanceTimersByTime(1000);

    expect(runtime.connect).toHaveBeenCalledTimes(1);
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

describe('SnapshotStore.notifyVaultState', () => {
  it('向所有已连接端口广播 vault.state', () => {
    const store = new SnapshotStore();
    const first = createFakePort();
    const second = createFakePort();
    store.attach(first.port);
    store.attach(second.port);

    store.notifyVaultState('locked');

    expect(first.postMessage).toHaveBeenCalledWith({
      kind: 'evt',
      type: 'vault.state',
      state: 'locked',
    });
    expect(second.postMessage).toHaveBeenCalledTimes(1);
  });

  it('端口已失效时移除且不影响其他端口', () => {
    const store = new SnapshotStore();
    const alive = createFakePort();
    const dead = createFakePort();
    dead.postMessage.mockImplementation(() => {
      throw new Error('port-closed');
    });
    store.attach(alive.port);
    store.attach(dead.port);

    expect(() => store.notifyVaultState('unlocked')).not.toThrow();
    expect(alive.postMessage).toHaveBeenCalledTimes(1);

    store.notifyVaultState('locked');
    expect(alive.postMessage).toHaveBeenCalledTimes(2);
    expect(dead.postMessage).toHaveBeenCalledTimes(1);
  });
});
