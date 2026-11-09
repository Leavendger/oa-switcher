import { beforeEach, describe, expect, it } from 'vitest';
import { updateSystem } from '../../src/background/services/systemService';
import { LIMITS } from '../../src/shared/constants';
import type { OASystem } from '../../src/shared/types/system';
import { newSystemId } from '../../src/shared/types/ids';
import { writeSystems } from '../../src/storage/repo';
import { installChromeMock } from '../helpers/chromeMock';

const SYSTEM_ID = newSystemId();

function makeSystem(): OASystem {
  return {
    id: SYSTEM_ID,
    name: '蓝凌 OA',
    vendor: 'landray',
    enabled: true,
    origins: ['https://oa.example.com'],
    loginUrl: 'https://oa.example.com/login',
    homeUrl: 'https://oa.example.com/home',
    adapterConfig: { usernameFieldSelector: '#username' },
    permissionState: 'granted',
    urlSignatures: [],
    originPermissions: { 'https://oa.example.com': 'granted' },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('systemService.updateSystem', () => {
  beforeEach(async () => {
    installChromeMock();
    await writeSystems([makeSystem()]);
  });

  it('局部更新只改传入字段，保留 URL / origins / adapterConfig 等未传字段', async () => {
    const updated = await updateSystem(SYSTEM_ID, { name: '蓝凌 OA（新）' });

    expect(updated.name).toBe('蓝凌 OA（新）');
    expect(updated.vendor).toBe('landray');
    expect(updated.enabled).toBe(true);
    expect(updated.origins).toEqual(['https://oa.example.com']);
    expect(updated.loginUrl).toBe('https://oa.example.com/login');
    expect(updated.homeUrl).toBe('https://oa.example.com/home');
    expect(updated.adapterConfig).toEqual({ usernameFieldSelector: '#username' });
    expect(updated.createdAt).toBe(1);
  });

  it('URL 签名会 trim、去空并去重', async () => {
    const updated = await updateSystem(SYSTEM_ID, {
      urlSignatures: ['  https://oa.example.com/login.jsp ', '', 'https://oa.example.com/login.jsp'],
    });

    expect(updated.urlSignatures).toEqual(['https://oa.example.com/login.jsp']);
  });

  it('未传 urlSignatures 时保留原值', async () => {
    await writeSystems([{ ...makeSystem(), urlSignatures: ['re:^https://oa\\.example\\.com/oa/'] }]);

    const updated = await updateSystem(SYSTEM_ID, { name: '蓝凌 OA（改名）' });

    expect(updated.urlSignatures).toEqual(['re:^https://oa\\.example\\.com/oa/']);
  });

  it('URL 签名超过上限时返回 E_VALIDATION', async () => {
    const tooMany = Array.from(
      { length: LIMITS.signatureCount + 1 },
      (_, index) => `https://oa.example.com/p${index}`,
    );

    await expect(updateSystem(SYSTEM_ID, { urlSignatures: tooMany })).rejects.toMatchObject({
      code: 'E_VALIDATION',
    });
  });
});
