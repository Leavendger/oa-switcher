// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileContentScripts } from '../../src/background/contentRegistry';
import type { OASystem } from '../../src/shared/types/system';
import { newSystemId } from '../../src/shared/types/ids';
import { readSystems, writeSystems } from '../../src/storage/repo';
import { installChromeMock } from '../helpers/chromeMock';

function makeSystem(overrides: Partial<OASystem> = {}): OASystem {
  return {
    id: newSystemId(),
    name: 'OA',
    vendor: 'landray',
    enabled: true,
    origins: ['https://oa.example.com'],
    loginUrl: 'https://oa.example.com/login',
    homeUrl: null,
    adapterConfig: {},
    permissionState: 'unknown',
    urlSignatures: [],
    originPermissions: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function mockContains(value: boolean) {
  const spy = vi.spyOn(chrome.permissions, 'contains') as unknown as {
    mockResolvedValue: (result: boolean) => void;
  };
  spy.mockResolvedValue(value);
}

/** 按 origin 分别返回授权结果，用于验证 per-origin 权限派生。 */
function mockContainsByOrigin(results: Record<string, boolean>) {
  (
    vi.spyOn(chrome.permissions, 'contains') as unknown as {
      mockImplementation: (fn: (permissions: chrome.permissions.Permissions) => Promise<boolean>) => void;
    }
  ).mockImplementation(async (permissions) => {
    const origin = (permissions.origins ?? [])[0] ?? '';
    return results[origin] ?? results[origin.replace(/\/\*$/, '')] ?? false;
  });
}

describe('reconcileContentScripts', () => {
  beforeEach(() => {
    installChromeMock();
    vi.restoreAllMocks();
  });

  it('未授权时不注册脚本，并把状态标为 denied', async () => {
    mockContains(false);
    const system = makeSystem();
    await writeSystems([system]);
    const register = vi.spyOn(chrome.scripting, 'registerContentScripts');

    await reconcileContentScripts();

    expect(register).not.toHaveBeenCalled();
    const [stored] = await readSystems();
    expect(stored?.permissionState).toBe('denied');
  });

  it('已授权时按 origin 注册一个 content.js，并把状态标为 granted', async () => {
    mockContains(true);
    const system = makeSystem();
    await writeSystems([system]);
    const register = vi.spyOn(chrome.scripting, 'registerContentScripts');

    await reconcileContentScripts();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith([
      expect.objectContaining({
        id: expect.stringMatching(/^oa-switcher:/),
        matches: ['https://oa.example.com/*'],
        js: ['content.js'],
      }),
    ]);
    const [stored] = await readSystems();
    expect(stored?.permissionState).toBe('granted');
    expect(stored?.originPermissions).toEqual({ 'https://oa.example.com': 'granted' });
  });

  it('同 origin 多系统只注册一个脚本，避免重复注入', async () => {
    mockContains(true);
    await writeSystems([
      makeSystem({ name: 'A', urlSignatures: ['https://oa.example.com/a/login'] }),
      makeSystem({ name: 'B', urlSignatures: ['https://oa.example.com/b/login'] }),
    ]);
    const register = vi.spyOn(chrome.scripting, 'registerContentScripts');

    await reconcileContentScripts();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('权限按 origin 记录并由 origin 派生系统级状态（混合时为 unknown）', async () => {
    mockContainsByOrigin({ 'https://a.example.com/*': true, 'https://b.example.com/*': false });
    await writeSystems([
      makeSystem({ name: 'A', origins: ['https://a.example.com'], loginUrl: 'https://a.example.com/login' }),
      makeSystem({ name: 'B', origins: ['https://b.example.com'], loginUrl: 'https://b.example.com/login' }),
      makeSystem({
        name: 'C',
        origins: ['https://a.example.com', 'https://b.example.com'],
        loginUrl: 'https://a.example.com/login',
      }),
    ]);

    await reconcileContentScripts();

    const stored = await readSystems();
    const byName = (name: string) => stored.find((system) => system.name === name);

    expect(byName('A')?.originPermissions).toEqual({ 'https://a.example.com': 'granted' });
    expect(byName('A')?.permissionState).toBe('granted');
    expect(byName('B')?.originPermissions).toEqual({ 'https://b.example.com': 'denied' });
    expect(byName('B')?.permissionState).toBe('denied');
    expect(byName('C')?.permissionState).toBe('unknown');
  });

  it('重建前只注销本扩展的注册项', async () => {
    mockContains(true);
    await writeSystems([makeSystem()]);
    vi.spyOn(chrome.scripting, 'getRegisteredContentScripts').mockResolvedValue([
      { id: 'oa-switcher:old' },
      { id: 'another-extension' },
    ] as never);
    const unregister = vi.spyOn(chrome.scripting, 'unregisterContentScripts');

    await reconcileContentScripts();

    expect(unregister).toHaveBeenCalledWith({ ids: ['oa-switcher:old'] });
  });

  it('权限查询异常时不注册且不抛出', async () => {
    vi.spyOn(chrome.permissions, 'contains').mockRejectedValue(
      new Error('permission query failed') as never,
    );
    const system = makeSystem();
    await writeSystems([system]);
    const register = vi.spyOn(chrome.scripting, 'registerContentScripts');

    await expect(reconcileContentScripts()).resolves.toBeUndefined();

    expect(register).not.toHaveBeenCalled();
    const [stored] = await readSystems();
    expect(stored?.permissionState).toBe('denied');
  });

  it('并发触发时串行执行，不会因重复注册把状态误标为 denied', async () => {
    mockContains(true);
    const system = makeSystem();
    await writeSystems([system]);

    const ids = new Set<string>();
    vi.spyOn(chrome.scripting, 'getRegisteredContentScripts').mockImplementation(
      async () => Array.from(ids).map((id) => ({ id }) as never),
    );
    vi.spyOn(chrome.scripting, 'unregisterContentScripts').mockImplementation((async (options: {
      ids: string[];
    }) => {
      for (const id of options.ids) ids.delete(id);
    }) as never);
    vi.spyOn(chrome.scripting, 'registerContentScripts').mockImplementation((async (
      scripts: { id: string }[],
    ) => {
      for (const script of scripts) {
        // 与真实 Chrome 一致：并发注册同一 id 会抛 Duplicate script ID
        if (ids.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
        ids.add(script.id);
      }
    }) as never);

    await Promise.all([
      reconcileContentScripts(),
      reconcileContentScripts(),
      reconcileContentScripts(),
    ]);

    const [stored] = await readSystems();
    expect(stored?.permissionState).toBe('granted');
    expect(ids.size).toBe(1);
  });
});
