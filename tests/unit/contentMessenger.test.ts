// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOaTab } from '../../src/background/contentMessenger';
import { isFlowError } from '../../src/shared/types/errors';
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

function mockActiveTab(url: string) {
  vi.spyOn(chrome.tabs, 'query').mockResolvedValue([{ id: 55, url }] as never);
}

/** content.ping 回执：只要 id 对上就算页面脚本就绪。 */
function mockContentReady() {
  vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((async (_tabId: number, message: unknown) => {
    const request = message as { id: string };
    return {
      kind: 'res',
      id: request.id,
      ok: true,
      data: { url: '', title: '', ready: true, frame: 'top', adapterVersion: 'test' },
    };
  }) as never);
}

async function expectCode(action: Promise<unknown>, code: string): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    expect(isFlowError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return error;
  }
  throw new Error(`expected ${code}`);
}

describe('resolveOaTab 归属校验', () => {
  beforeEach(() => {
    installChromeMock();
    vi.restoreAllMocks();
  });

  it('单系统独占 origin 时 origin 命中即可', async () => {
    const system = makeSystem();
    await writeSystems([system]);
    mockActiveTab(`${ORIGIN}/portal/page.jsp`);
    mockContentReady();

    await expect(resolveOaTab(system)).resolves.toBe(55);
  });

  it('同 origin 多系统时，URL 未命中目标签名返回 E_NO_OA_TAB(signature-mismatch)', async () => {
    const target = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/a/*`] });
    const other = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/b/*`] });
    await writeSystems([target, other]);
    mockActiveTab(`${ORIGIN}/b/login.jsp`);

    const error = await expectCode(resolveOaTab(target), 'E_NO_OA_TAB');
    expect((error as { detail?: { reason?: string } }).detail?.reason).toBe('signature-mismatch');
  });

  it('同 origin 多系统且 URL 命中目标签名时放行', async () => {
    const target = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/a/*`] });
    const other = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/b/*`] });
    await writeSystems([target, other]);
    mockActiveTab(`${ORIGIN}/a/login.jsp`);
    mockContentReady();

    await expect(resolveOaTab(target)).resolves.toBe(55);
  });

  it('活动页 origin 与目标系统不一致时返回 origin-mismatch', async () => {
    const system = makeSystem();
    await writeSystems([system]);
    mockActiveTab('https://other.example.com/login');

    const error = await expectCode(resolveOaTab(system), 'E_NO_OA_TAB');
    expect((error as { detail?: { reason?: string } }).detail?.reason).toBe('origin-mismatch');
  });
});
