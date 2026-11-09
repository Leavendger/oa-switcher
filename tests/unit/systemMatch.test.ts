// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { matchUrlToSystems, pageKindOf, systemSignatures } from '../../src/shared/systemMatch';
import { directoryPrefix, patternSpecificity } from '../../src/shared/urlMatch';
import { newSystemId } from '../../src/shared/types/ids';
import type { OASystem } from '../../src/shared/types/system';

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

describe('URL 具体度与路径前缀', () => {
  it('命中越长的字面量越具体，未命中为 -1', () => {
    const url = `${ORIGIN}/a/login`;
    expect(patternSpecificity(`${ORIGIN}/a/login`, url)).toBeGreaterThan(
      patternSpecificity(`${ORIGIN}/*`, url),
    );
    expect(patternSpecificity('re:^https://oa\\.example\\.com/a/', url)).toBeGreaterThan(0);
    expect(patternSpecificity(`${ORIGIN}/b/login`, url)).toBe(-1);
  });

  it('目录前缀按最后一个斜杠截断', () => {
    expect(directoryPrefix('/a/login.jsp')).toBe('/a/');
    expect(directoryPrefix('/login.jsp')).toBe('/');
    expect(directoryPrefix('/')).toBe('/');
  });
});

describe('pageKindOf', () => {
  it('区分 web / 扩展页 / 新标签页 / 浏览器内置页', () => {
    expect(pageKindOf(`${ORIGIN}/login.jsp`)).toBe('web');
    expect(pageKindOf('chrome-extension://abc/popup/index.html')).toBe('extension');
    expect(pageKindOf('chrome://newtab/')).toBe('newtab');
    expect(pageKindOf('chrome://extensions/')).toBe('browser');
    expect(pageKindOf(null)).toBe('unknown');
  });
});

describe('systemSignatures', () => {
  it('显式签名优先，未配置时回退登录页与首页', () => {
    expect(
      systemSignatures(
        makeSystem({ urlSignatures: [`${ORIGIN}/a/*`], loginUrl: `${ORIGIN}/login.jsp` }),
      ),
    ).toEqual([`${ORIGIN}/a/*`]);

    expect(
      systemSignatures(
        makeSystem({ urlSignatures: [], loginUrl: `${ORIGIN}/login.jsp`, homeUrl: `${ORIGIN}/home` }),
      ),
    ).toEqual([`${ORIGIN}/login.jsp`, `${ORIGIN}/home`]);
  });
});

describe('matchUrlToSystems', () => {
  it('非 web 页面一律不可识别，且不产生候选', () => {
    const system = makeSystem();
    const result = matchUrlToSystems('chrome-extension://abc/popup/index.html', [system]);
    expect(result.status).toBe('none');
    expect(result.pageKind).toBe('extension');
    expect(result.candidates).toEqual([]);
  });

  it('origin 不匹配时返回 none', () => {
    const result = matchUrlToSystems('https://other.example.com/login', [makeSystem()]);
    expect(result.status).toBe('none');
    expect(result.originSystems).toEqual([]);
  });

  it('同一 origin 只有一个启用系统时，origin 即可确定，并给出签名依据', () => {
    const system = makeSystem();
    const result = matchUrlToSystems(`${ORIGIN}/login.jsp`, [system]);

    expect(result.status).toBe('matched');
    expect(result.systemId).toBe(system.id);
    expect(result.basis).toEqual({ kind: 'signature', pattern: `${ORIGIN}/login.jsp` });
    expect(result.rememberKey).toBe(`${ORIGIN}/`);
  });

  it('单系统且 URL 未命中签名时仍按 origin 归属，避免误判未识别', () => {
    const system = makeSystem({ urlSignatures: [`${ORIGIN}/a/*`] });
    const result = matchUrlToSystems(`${ORIGIN}/portal/page.jsp`, [system]);

    expect(result.status).toBe('matched');
    expect(result.basis).toEqual({ kind: 'origin' });
  });

  it('同域多系统按最长最具体签名命中', () => {
    const a = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/a/*`] });
    const b = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/b/login.jsp`] });

    const result = matchUrlToSystems(`${ORIGIN}/b/login.jsp`, [a, b]);

    expect(result.status).toBe('matched');
    expect(result.systemId).toBe(b.id);
    expect(result.originSystems).toHaveLength(2);
    expect(result.originSystems.find((item) => item.systemId === a.id)?.matchedPattern).toBeNull();
  });

  it('同域多系统具体度并列时返回 ambiguous，并带上候选', () => {
    const a = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/*`] });
    const b = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/*`] });

    const result = matchUrlToSystems(`${ORIGIN}/login.jsp`, [a, b]);

    expect(result.status).toBe('ambiguous');
    expect(result.systemId).toBeNull();
    expect(result.candidates.map((item) => item.systemId).sort()).toEqual([a.id, b.id].sort());
  });

  it('歧义时命中「记住本次选择」的作用域前缀则直接确定', () => {
    const a = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/*`] });
    const b = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/*`] });

    const result = matchUrlToSystems(`${ORIGIN}/a/login.jsp`, [a, b], {
      [`${ORIGIN}/a/`]: b.id,
    });

    expect(result.status).toBe('matched');
    expect(result.systemId).toBe(b.id);
    expect(result.basis).toEqual({ kind: 'remembered' });
  });

  it('记住的选择只在对应路径前缀内生效', () => {
    const a = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/*`] });
    const b = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/*`] });

    const result = matchUrlToSystems(`${ORIGIN}/b/login.jsp`, [a, b], {
      [`${ORIGIN}/a/`]: b.id,
    });

    expect(result.status).toBe('ambiguous');
  });

  it('同域多系统且没有任何签名命中时返回 ambiguous，交由用户选择', () => {
    const a = makeSystem({ name: 'A', urlSignatures: [`${ORIGIN}/a/*`] });
    const b = makeSystem({ name: 'B', urlSignatures: [`${ORIGIN}/b/*`] });

    const result = matchUrlToSystems(`${ORIGIN}/other/page.jsp`, [a, b]);

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('停用系统不参与识别', () => {
    const disabled = makeSystem({ enabled: false, urlSignatures: [`${ORIGIN}/a/*`] });
    const result = matchUrlToSystems(`${ORIGIN}/a/login.jsp`, [disabled]);

    expect(result.status).toBe('none');
    expect(result.originSystems).toEqual([]);
  });
});
