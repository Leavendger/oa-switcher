// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/messaging/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/messaging/client')>();
  return { ...actual, callBackground: vi.fn() };
});

import { VaultGate } from '../../src/popup/components/VaultGate';
import { useFlowPort } from '../../src/popup/hooks';
import { callBackground } from '../../src/shared/messaging/client';
import { DEFAULT_SETTINGS, type VaultState } from '../../src/shared/types/settings';
import type { AppBootstrapData } from '../../src/shared/types/messages';
import { useBootstrap } from '../../src/ui/useBootstrap';
import { installRuntimePortMock } from '../helpers/fakePort';

const mockedCall = callBackground as unknown as ReturnType<typeof vi.fn>;

function bootstrap(state: VaultState): AppBootstrapData {
  return { settings: DEFAULT_SETTINGS, systems: [], groups: [], accounts: [], vault: { state } };
}

/** 复现 Popup 顶部结构：bootstrap 提供 vault 状态，端口事件触发重拉。 */
function Probe() {
  const { data, refresh } = useBootstrap();
  useFlowPort(refresh);
  if (!data) return <p>loading</p>;
  return <VaultGate state={data.vault.state} onChanged={async () => undefined} />;
}

describe('Popup 保险库状态以后台为准', () => {
  let container: HTMLDivElement;
  let root: Root;
  let runtime: ReturnType<typeof installRuntimePortMock>;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    runtime = installRuntimePortMock();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mockedCall.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('SW 回收断开端口后，重新拉取到 locked 并渲染解锁入口', async () => {
    // 第一次（陈旧内存态）返回 unlocked；SW 重启后权威状态为 locked
    mockedCall.mockImplementation(async (type: string) => {
      if (type === 'app.bootstrap') {
        return mockedCall.mock.calls.filter(([name]) => name === 'app.bootstrap').length === 1
          ? bootstrap('unlocked')
          : bootstrap('locked');
      }
      if (type === 'flow.getState') return null;
      return null;
    });

    await act(async () => {
      root.render(<Probe />);
    });

    expect(container.textContent).toContain('保险库已解锁');
    expect(container.textContent).not.toContain('保险库已锁定');

    // 模拟扩展重载 / SW 被回收：端口断开 -> 重拉 -> 显示 locked
    await act(async () => {
      runtime.created[0]?.emitDisconnect();
    });

    expect(container.textContent).toContain('保险库已锁定');
    expect(container.textContent).not.toContain('保险库已解锁');
    const unlockButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '解锁',
    );
    expect(unlockButton).toBeTruthy();
  });

  it('重新聚焦时以后台权威状态为准', async () => {
    let call = 0;
    mockedCall.mockImplementation(async (type: string) => {
      if (type === 'app.bootstrap') {
        call += 1;
        return call === 1 ? bootstrap('unlocked') : bootstrap('locked');
      }
      if (type === 'flow.getState') return null;
      return null;
    });

    await act(async () => {
      root.render(<Probe />);
    });
    expect(container.textContent).toContain('保险库已解锁');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(container.textContent).toContain('保险库已锁定');
  });

  it('收到 vault.state 广播后按后台权威状态更新', async () => {
    let call = 0;
    mockedCall.mockImplementation(async (type: string) => {
      if (type === 'app.bootstrap') {
        call += 1;
        return call === 1 ? bootstrap('unlocked') : bootstrap('locked');
      }
      if (type === 'flow.getState') return null;
      return null;
    });

    await act(async () => {
      root.render(<Probe />);
    });
    expect(container.textContent).toContain('保险库已解锁');

    await act(async () => {
      runtime.created[0]?.emitMessage({ kind: 'evt', type: 'vault.state', state: 'locked' });
    });

    expect(container.textContent).toContain('保险库已锁定');
  });
});
