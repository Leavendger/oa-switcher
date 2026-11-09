import { describe, expect, it } from 'vitest';
import { LandrayAdapter } from '../../src/adapters/landray/adapter';
import { createAdapter } from '../../src/adapters/registry';
import { UnsupportedAdapter } from '../../src/adapters/unsupported';
import type { AdapterContext } from '../../src/adapters/types';
import type { OaVendor } from '../../src/shared/types/system';

const CONTEXT = {} as AdapterContext;

describe('Adapter 工厂', () => {
  it('landray 返回完整实现实例', () => {
    const adapter = createAdapter('landray', {});
    expect(adapter).toBeInstanceOf(LandrayAdapter);
    expect(adapter.vendor).toBe('landray');
    for (const method of [
      'detectLoginPage',
      'detectLoginState',
      'detectBlockers',
      'logout',
      'waitForLoginPage',
      'fillCredentials',
      'submitLogin',
      'verifyLogin',
    ] as const) {
      expect(typeof adapter[method]).toBe('function');
    }
  });

  it('other 返回 UnsupportedAdapter 且调用明确报 E_SYSTEM_UNSUPPORTED', async () => {
    const adapter = createAdapter('other', {});
    expect(adapter).toBeInstanceOf(UnsupportedAdapter);
    await expect(adapter.detectLoginState(CONTEXT)).rejects.toMatchObject({
      code: 'E_SYSTEM_UNSUPPORTED',
    });
  });

  it('未知 vendor 直接抛 E_SYSTEM_UNSUPPORTED', () => {
    expect(() => createAdapter('nope' as OaVendor, {})).toThrowError('E_SYSTEM_UNSUPPORTED');
  });
});
