// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openOaTab,
  resolveActiveTab,
} from '../../src/background/services/systemResolutionService';
import { newSystemId } from '../../src/shared/types/ids';
import type { OASystem } from '../../src/shared/types/system';
import { writeSystems } from '../../src/storage/repo';
import { installChromeMock } from '../helpers/chromeMock';

const ORIGIN = 'https://oa.example.com';

function makeSystem(overrides: Partial<OASystem> = {}): OASystem {
  return {
    id: newSystemId(),
    name: 'OA',
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
    ...overrides,
  };
}

function mockActiveTab(tab: { id?: number; url?: string } | null) {
  vi.spyOn(chrome.tabs, 'query').mockResolvedValue((tab ? [tab] : []) as never);
}

describe('system.resolveActiveTab', () => {
  beforeEach(() => {
    installChromeMock();
    vi.restoreAllMocks();
  });

  it('活动页命中系统时返回 matched 与 tabId', async () => {
    const system = makeSystem();
    await writeSystems([system]);
    mockActiveTab({ id: 77, url: `${ORIGIN}/login.jsp` });

    const result = await resolveActiveTab();

    expect(result.status).toBe('matched');
    expect(result.systemId).toBe(system.id);
    expect(result.tabId).toBe(77);
    expect(result.basis?.kind).toBe('signature');
  });

  it('活动页是扩展页时返回 none，并标记 pageKind', async () => {
    await writeSystems([makeSystem()]);
    mockActiveTab({ id: 9, url: 'chrome-extension://abc/popup/index.html' });

    const result = await resolveActiveTab();

    expect(result.status).toBe('none');
    expect(result.pageKind).toBe('extension');
    expect(result.tabId).toBe(9);
  });

  it('同域多系统签名并列时返回 ambiguous 候选', async () => {
    const a = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/*`] });
    const b = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/*`] });
    await writeSystems([a, b]);
    mockActiveTab({ id: 3, url: `${ORIGIN}/login.jsp` });

    const result = await resolveActiveTab();

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('取不到活动标签页时不抛错，返回 none', async () => {
    await writeSystems([makeSystem()]);
    mockActiveTab(null);

    const result = await resolveActiveTab();

    expect(result.status).toBe('none');
    expect(result.tabId).toBeNull();
  });
});

describe('system.openOaTab', () => {
  beforeEach(() => {
    installChromeMock();
    vi.restoreAllMocks();
  });

  it('已有同 origin 标签页时激活而不是新建', async () => {
    const system = makeSystem();
    await writeSystems([system]);
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      { id: 12, windowId: 4, url: `${ORIGIN}/portal/page.jsp` },
    ] as never);
    const update = vi.spyOn(chrome.tabs, 'update').mockResolvedValue({} as never);
    const create = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 99 } as never);

    const result = await openOaTab(system.id);

    expect(result).toEqual({ tabId: 12, created: false });
    expect(update).toHaveBeenCalledWith(12, { active: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('没有可用标签页时按登录页新建', async () => {
    const system = makeSystem();
    await writeSystems([system]);
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([] as never);
    const create = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 21 } as never);

    const result = await openOaTab(system.id);

    expect(result).toEqual({ tabId: 21, created: true });
    expect(create).toHaveBeenCalledWith({ url: `${ORIGIN}/login.jsp`, active: true });
  });

  it('没有任何可用系统时返回 E_VALIDATION', async () => {
    await writeSystems([]);

    await expect(openOaTab()).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });
});
