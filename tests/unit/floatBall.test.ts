// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/messaging/client', () => ({
  callBackground: vi.fn(),
  connectFlowPort: vi.fn(() => () => undefined),
}));

import {
  clampBallPoint,
  mountFloatingBall,
  snapBallPoint,
  startFloatingBall,
} from '../../src/content/floatBall';
import { FLOAT_STORAGE_KEYS } from '../../src/shared/constants';
import { callBackground } from '../../src/shared/messaging/client';
import type { OASystem } from '../../src/shared/types/system';
import { installChromeMock } from '../helpers/chromeMock';

const HOST_ID = 'oa-switcher-float-root';
const ORIGIN = window.location.origin;

const mockedCall = callBackground as unknown as ReturnType<typeof vi.fn>;

function makeSystem(): OASystem {
  return {
    id: 'sys_aaaaaaaaaaaa',
    name: '示例公司 OA（蓝凌）',
    vendor: 'landray',
    enabled: true,
    origins: [ORIGIN],
    urlSignatures: [],
    loginUrl: `${ORIGIN}/login.jsp`,
    homeUrl: null,
    adapterConfig: {},
    permissionState: 'granted',
    originPermissions: { [ORIGIN]: 'granted' },
    createdAt: 1,
    updatedAt: 1,
  } as unknown as OASystem;
}

function wireBackground(
  overrides: Partial<Record<string, unknown>> = {},
): void {
  mockedCall.mockImplementation(async (type: string) => {
    if (type in overrides) return overrides[type];
    switch (type) {
      case 'ui.getFloatPrefs':
        return { enabled: true, dismissed: {}, positions: {} };
      case 'system.resolveForUrl':
        return {
          tabId: null,
          url: window.location.href,
          pageKind: 'web',
          origin: ORIGIN,
          status: 'matched',
          systemId: 'sys_aaaaaaaaaaaa',
          basis: { kind: 'signature', pattern: `${ORIGIN}/login.jsp` },
          candidates: [],
          originSystems: [],
          rememberKey: `${ORIGIN}/`,
        };
      case 'system.list':
        return [makeSystem()];
      case 'account.list':
        return [
          {
            id: 'acc_aaaaaaaaaaaa',
            label: 'user01',
            username: 'user01',
            systemId: 'sys_aaaaaaaaaaaa',
            groupId: null,
            role: null,
            note: null,
            enabled: true,
            sortOrder: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ];
      case 'vault.status':
        return { state: 'unlocked' };
      case 'flow.getState':
        return null;
      default:
        return null;
    }
  });
}

function cleanup(): void {
  document.getElementById(HOST_ID)?.remove();
}

describe('snapBallPoint', () => {
  const viewport = { width: 800, height: 600 };

  it('距左边缘 32px 以内吸附到左边距', () => {
    expect(snapBallPoint({ x: 30, y: 200 }, viewport)).toEqual({ x: 8, y: 200 });
    expect(snapBallPoint({ x: 8, y: 200 }, viewport)).toEqual({ x: 8, y: 200 });
  });

  it('距右边缘 32px 以内吸附到右边距', () => {
    expect(snapBallPoint({ x: 800 - 44 - 20, y: 200 }, viewport)).toEqual({ x: 800 - 44 - 8, y: 200 });
  });

  it('中间区域保持原位，不改变纵向坐标', () => {
    expect(snapBallPoint({ x: 400, y: 123 }, viewport)).toEqual({ x: 400, y: 123 });
  });

  it('越界坐标先夹取再判断吸附', () => {
    expect(snapBallPoint({ x: -50, y: -50 }, viewport)).toEqual({ x: 8, y: 8 });
  });
});

describe('clampBallPoint', () => {
  it('把越界坐标收回视口内', () => {
    expect(clampBallPoint({ x: -100, y: -100 }, { width: 800, height: 600 })).toEqual({ x: 8, y: 8 });
    expect(clampBallPoint({ x: 5000, y: 5000 }, { width: 800, height: 600 })).toEqual({
      x: 800 - 44 - 8,
      y: 600 - 44 - 8,
    });
  });

  it('视口小于球体时贴左上角，不产生负值', () => {
    expect(clampBallPoint({ x: 50, y: 50 }, { width: 20, height: 20 })).toEqual({ x: 8, y: 8 });
  });
});

describe('mountFloatingBall', () => {
  beforeEach(() => {
    cleanup();
    installChromeMock();
    mockedCall.mockReset();
  });

  it('未识别为系统页面时不渲染任何节点', async () => {
    wireBackground({
      'system.resolveForUrl': {
        tabId: null,
        url: 'https://other.example.com/x',
        pageKind: 'web',
        origin: 'https://other.example.com',
        status: 'none',
        systemId: null,
        basis: null,
        candidates: [],
        originSystems: [],
        rememberKey: null,
      },
    });

    await mountFloatingBall();

    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('同源但签名不匹配（status=none）时同样不渲染', async () => {
    wireBackground({
      'system.resolveForUrl': {
        tabId: null,
        url: `${ORIGIN}/other/page.jsp`,
        pageKind: 'web',
        origin: ORIGIN,
        status: 'none',
        systemId: null,
        basis: null,
        candidates: [],
        originSystems: [],
        rememberKey: `${ORIGIN}/other/`,
      },
    });

    await mountFloatingBall();

    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('站点已被关闭时不渲染', async () => {
    wireBackground({
      'ui.getFloatPrefs': { enabled: true, dismissed: { [ORIGIN]: true }, positions: {} },
    });

    await mountFloatingBall();

    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('全局开关关闭时不渲染', async () => {
    wireBackground({
      'ui.getFloatPrefs': { enabled: false, dismissed: {}, positions: {} },
    });

    await mountFloatingBall();

    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('识别到系统时用 Shadow DOM 渲染悬浮球，且只含账号标签与用户名', async () => {
    wireBackground();

    await mountFloatingBall();

    const host = document.getElementById(HOST_ID);
    expect(host).not.toBeNull();
    const shadow = host!.shadowRoot;
    expect(shadow).not.toBeNull();
    expect(shadow!.textContent).toContain('OA');
    expect(shadow!.textContent).toContain('示例公司 OA（蓝凌）');
    expect(shadow!.textContent).toContain('user01');
    expect(shadow!.textContent).toContain('user01');
    expect(shadow!.textContent?.toLowerCase()).not.toContain('password');
    expect(shadow!.querySelector('.ball')?.getAttribute('aria-label')).toBe('OA 账号切换');
  });

  it('恢复保存的位置，并限制在视口内', async () => {
    wireBackground({
      'ui.getFloatPrefs': {
        enabled: true,
        dismissed: {},
        positions: { [ORIGIN]: { x: -999, y: -999 } },
      },
    });

    await mountFloatingBall();

    const dock = document.getElementById(HOST_ID)?.shadowRoot?.querySelector<HTMLElement>('.dock');
    expect(dock?.style.left).toBe('8px');
    expect(dock?.style.top).toBe('8px');
  });

  it('点击展开面板，Esc 收起（不依赖焦点在球内），关闭态不拦截 Esc', async () => {
    wireBackground();
    await mountFloatingBall();

    const shadow = document.getElementById(HOST_ID)!.shadowRoot!;
    const ball = shadow.querySelector<HTMLButtonElement>('.ball')!;
    const panel = shadow.querySelector<HTMLElement>('.panel')!;

    const idleEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(idleEsc);
    expect(idleEsc.defaultPrevented).toBe(false);
    expect(panel.hidden).toBe(true);

    ball.click();
    expect(panel.hidden).toBe(false);
    expect(ball.getAttribute('aria-expanded')).toBe('true');

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(panel.hidden).toBe(true);
    expect(ball.getAttribute('aria-expanded')).toBe('false');
  });

  it('关闭按钮只收起账号列表，小球与系统名保留', async () => {
    wireBackground();
    await mountFloatingBall();

    const shadow = document.getElementById(HOST_ID)!.shadowRoot!;
    const ball = shadow.querySelector<HTMLButtonElement>('.ball')!;
    const label = shadow.querySelector<HTMLButtonElement>('.label')!;
    const panel = shadow.querySelector<HTMLElement>('.panel')!;
    const dismiss = shadow.querySelector<HTMLButtonElement>('.dismiss')!;

    expect(label.hidden).toBe(false);
    expect(label.textContent).toBe('示例公司 OA（蓝凌）');
    expect(dismiss.getAttribute('aria-label')).toBe('关闭账号列表');

    ball.click();
    expect(panel.hidden).toBe(false);
    expect(label.hidden).toBe(true);

    dismiss.click();
    expect(panel.hidden).toBe(true);
    expect(label.hidden).toBe(false);
    expect(document.getElementById(HOST_ID)).not.toBeNull();
    expect(mockedCall).not.toHaveBeenCalledWith('ui.dismissFloat', expect.anything());

    ball.click();
    expect(panel.hidden).toBe(false);
  });

  it('点外部区域收起面板，小球保留', async () => {
    wireBackground();
    await mountFloatingBall();

    const shadow = document.getElementById(HOST_ID)!.shadowRoot!;
    const ball = shadow.querySelector<HTMLButtonElement>('.ball')!;
    const panel = shadow.querySelector<HTMLElement>('.panel')!;

    ball.click();
    expect(panel.hidden).toBe(false);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(panel.hidden).toBe(true);
    expect(document.getElementById(HOST_ID)).not.toBeNull();
  });

  it('开关变化时即时挂载与移除，无需刷新页面', async () => {
    const chromeMock = installChromeMock();
    wireBackground();

    startFloatingBall();
    await vi.waitFor(() => expect(document.getElementById(HOST_ID)).not.toBeNull());

    chromeMock.emitStorageChange({ [FLOAT_STORAGE_KEYS.enabled]: { newValue: false } });
    await vi.waitFor(() => expect(document.getElementById(HOST_ID)).toBeNull());

    chromeMock.emitStorageChange({ [FLOAT_STORAGE_KEYS.enabled]: { newValue: true } });
    await vi.waitFor(() => expect(document.getElementById(HOST_ID)).not.toBeNull());
  });

  it('站点级隐藏与恢复同样即时生效', async () => {
    const chromeMock = installChromeMock();
    wireBackground();

    startFloatingBall();
    await vi.waitFor(() => expect(document.getElementById(HOST_ID)).not.toBeNull());

    chromeMock.emitStorageChange({
      [FLOAT_STORAGE_KEYS.dismissed]: { newValue: { [ORIGIN]: true } },
    });
    await vi.waitFor(() => expect(document.getElementById(HOST_ID)).toBeNull());

    chromeMock.emitStorageChange({
      [FLOAT_STORAGE_KEYS.dismissed]: { newValue: {} },
    });
    await vi.waitFor(() => expect(document.getElementById(HOST_ID)).not.toBeNull());
  });
});
