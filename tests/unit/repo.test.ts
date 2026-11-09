import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ThemePreference } from '../../src/shared/types/settings';
import type { SystemId } from '../../src/shared/types/ids';
import { readSettings, readSystems, writeSettings, writeSystems } from '../../src/storage/repo';
import { installChromeMock } from '../helpers/chromeMock';

describe('settings 读写', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('空存储读出完整默认值', async () => {
    await expect(readSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('部分更新不覆盖其他字段', async () => {
    const next = await writeSettings({ theme: 'dark' });
    expect(next.theme).toBe('dark');
    expect(next.autoLockMinutes).toBe(DEFAULT_SETTINGS.autoLockMinutes);
    expect(next.confirmBeforeSwitch).toBe(DEFAULT_SETTINGS.confirmBeforeSwitch);

    const reloaded = await readSettings();
    expect(reloaded).toEqual(next);
  });

  it('非法值被钳制/回退，不写入脏数据', async () => {
    const next = await writeSettings({
      autoLockMinutes: -5,
      theme: 'neon' as ThemePreference,
    });
    expect(next.autoLockMinutes).toBe(0);
    expect(next.theme).toBe('system');
    expect(next.schemaVersion).toBe(1);
  });

  it('rememberedSystems 只保留字符串值', async () => {
    const next = await writeSettings({
      rememberedSystems: {
        'https://oa.example.com/a/': 'sys_aaaaaaaaaaaa' as SystemId,
        'https://oa.example.com/b/': 42 as never,
      },
    });

    expect(next.rememberedSystems).toEqual({ 'https://oa.example.com/a/': 'sys_aaaaaaaaaaaa' });
  });
});

describe('systems 读取兼容', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('旧数据缺失 urlSignatures / originPermissions 时补默认值', async () => {
    await writeSystems([
      {
        id: 'sys_aaaaaaaaaaaa',
        name: '旧系统',
        vendor: 'landray',
        enabled: true,
        origins: ['https://oa.example.com'],
        loginUrl: 'https://oa.example.com/login',
        homeUrl: null,
        adapterConfig: {},
        permissionState: 'granted',
        createdAt: 1,
        updatedAt: 1,
      } as never,
    ]);

    const [stored] = await readSystems();
    expect(stored?.urlSignatures).toEqual([]);
    expect(stored?.originPermissions).toEqual({});
    expect(stored?.permissionState).toBe('granted');
  });
});
