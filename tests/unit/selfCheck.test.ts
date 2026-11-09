import { describe, expect, it } from 'vitest';
import {
  buildSelfCheckResult,
  collectConfiguredSelectors,
  evaluatePreset,
  evaluateSelfCheckState,
} from '../../src/background/discovery/selfCheck';
import type { SelfCheckField } from '../../src/shared/types/discovery';

const ORIGIN = 'http://oa.example.com';

function field(
  key: SelfCheckField['key'],
  count: number | null,
  selector = 'input[name="x"]',
): SelfCheckField {
  return { key, label: key, selector, count, error: count === null ? 'invalid-selector' : null };
}

describe('自检状态判定', () => {
  it('命中登录成功 URL 规则时判定已登录', () => {
    const result = evaluateSelfCheckState({
      url: `${ORIGIN}/sys/portal/page.jsp`,
      fields: [],
      authenticatedUrlPattern: `${ORIGIN}/sys/portal/page.jsp*`,
      loggedOutUrlPattern: '',
      loginPageUrlPattern: `${ORIGIN}/login.jsp*`,
    });
    expect(result.state).toBe('loggedIn');
    expect(result.notes.join('\n')).toContain('登录成功 URL 规则');
  });

  it('命中登录页规则或未登录标记时判定未登录', () => {
    const byUrl = evaluateSelfCheckState({
      url: `${ORIGIN}/login.jsp#system/systemview`,
      fields: [],
      authenticatedUrlPattern: `${ORIGIN}/sys/portal/page.jsp*`,
      loggedOutUrlPattern: '',
      loginPageUrlPattern: `${ORIGIN}/login.jsp*`,
    });
    expect(byUrl.state).toBe('loggedOut');

    const byMarker = evaluateSelfCheckState({
      url: `${ORIGIN}/somewhere`,
      fields: [field('loggedOutMarkerSelector', 1)],
      authenticatedUrlPattern: '',
      loggedOutUrlPattern: '',
      loginPageUrlPattern: '',
    });
    expect(byMarker.state).toBe('loggedOut');
  });

  it('已登录标记命中时判定已登录', () => {
    const result = evaluateSelfCheckState({
      url: `${ORIGIN}/sys/portal/page.jsp`,
      fields: [field('loggedInMarkerSelector', 1)],
      authenticatedUrlPattern: '',
      loggedOutUrlPattern: '',
      loginPageUrlPattern: '',
    });
    expect(result.state).toBe('loggedIn');
  });

  it('两类证据同时命中时判定无法判断，并说明冲突', () => {
    const result = evaluateSelfCheckState({
      url: `${ORIGIN}/login.jsp#system/systemview`,
      fields: [field('loggedInMarkerSelector', 1)],
      authenticatedUrlPattern: `${ORIGIN}/login.jsp*`,
      loggedOutUrlPattern: '',
      loginPageUrlPattern: `${ORIGIN}/login.jsp*`,
    });
    expect(result.state).toBe('unknown');
    expect(result.notes.join('\n')).toContain('同时命中');
  });

  it('没有任何判定信号时明确说明，而不是静默返回', () => {
    const result = evaluateSelfCheckState({
      url: `${ORIGIN}/whatever`,
      fields: [],
      authenticatedUrlPattern: '',
      loggedOutUrlPattern: '',
      loginPageUrlPattern: '',
    });
    expect(result.state).toBe('unknown');
    expect(result.notes.join('\n')).toContain('尚未配置任何可用的登录态判定信号');
  });

  it('已配置但未命中时也给出说明', () => {
    const result = evaluateSelfCheckState({
      url: `${ORIGIN}/whatever`,
      fields: [field('loggedInMarkerSelector', 0), field('loggedOutMarkerSelector', 0)],
      authenticatedUrlPattern: `${ORIGIN}/home*`,
      loggedOutUrlPattern: '',
      loginPageUrlPattern: `${ORIGIN}/login.jsp*`,
    });
    expect(result.state).toBe('unknown');
    expect(result.notes.join('\n')).toContain('都没有命中');
  });
});

describe('自检选择器收集', () => {
  it('只收集非空选择器，并展开 submit / logout 触发器', () => {
    const entries = collectConfiguredSelectors({
      usernameFieldSelector: 'input[name="u"]',
      passwordFieldSelector: '   ',
      submitTrigger: { kind: 'click', selector: 'input[name="btn"]' },
      logoutTrigger: { kind: 'click', selector: '#logout', confirmSelector: '#confirm' },
      loggedOutUrlPattern: `${ORIGIN}/login.jsp*`,
    });

    expect(entries.map((entry) => entry.key)).toEqual([
      'usernameFieldSelector',
      'submitSelector',
      'logoutSelector',
      'logoutConfirmSelector',
    ]);
    expect(entries.map((entry) => entry.selector)).toEqual([
      'input[name="u"]',
      'input[name="btn"]',
      '#logout',
      '#confirm',
    ]);
  });

  it('buildSelfCheckResult 保留计数与错误信息', () => {
    const result = buildSelfCheckResult({
      url: `${ORIGIN}/login.jsp`,
      tabId: 7,
      fields: [
        { key: 'usernameFieldSelector', selector: 'input[name="u"]', count: 1, error: null },
        { key: 'passwordFieldSelector', selector: 'input[', count: null, error: 'invalid-selector' },
      ],
      authenticatedUrlPattern: '',
      loggedOutUrlPattern: '',
      loginPageUrlPattern: `${ORIGIN}/login.jsp*`,
      preset: null,
    });

    expect(result.state).toBe('loggedOut');
    expect(result.fields[0]).toMatchObject({ count: 1, error: null });
    expect(result.fields[1]).toMatchObject({ count: null, error: 'invalid-selector' });
    expect(result.preset).toBeNull();
  });
});

describe('预设自检（是否可能已过期）', () => {
  const preset = { id: 'landray', version: '2026-11-09' };

  it('未登录页上登录相关预设字段全部命中时判定正常', () => {
    const result = buildSelfCheckResult({
      url: `${ORIGIN}/login.jsp`,
      tabId: 1,
      fields: [
        { key: 'loginFormReadySelector', selector: 'form[x]', count: 1, error: null },
        { key: 'usernameFieldSelector', selector: 'input[name="u"]', count: 1, error: null },
        { key: 'passwordFieldSelector', selector: 'input[name="p"]', count: 1, error: null },
        { key: 'loggedOutMarkerSelector', selector: 'input[name="u"]', count: 1, error: null },
      ],
      authenticatedUrlPattern: '',
      loggedOutUrlPattern: '',
      loginPageUrlPattern: `${ORIGIN}/login.jsp*`,
      preset,
    });

    expect(result.state).toBe('loggedOut');
    expect(result.preset).toMatchObject({ stale: false, staleFields: [] });
    expect(result.preset?.notes.join('\n')).toContain('均命中');
  });

  it('预设字段在当前页面未命中时明确提示「预设可能已过期」', () => {
    const result = buildSelfCheckResult({
      url: `${ORIGIN}/login.jsp`,
      tabId: 1,
      fields: [
        { key: 'loginFormReadySelector', selector: 'form[old]', count: 0, error: null },
        { key: 'usernameFieldSelector', selector: 'input[name="u"]', count: 1, error: null },
        { key: 'passwordFieldSelector', selector: 'input[name="p"]', count: 1, error: null },
        { key: 'loggedOutMarkerSelector', selector: 'input[name="u"]', count: 1, error: null },
      ],
      authenticatedUrlPattern: '',
      loggedOutUrlPattern: '',
      loginPageUrlPattern: `${ORIGIN}/login.jsp*`,
      preset,
    });

    expect(result.preset?.stale).toBe(true);
    expect(result.preset?.staleFields.map((item) => item.key)).toEqual(['loginFormReadySelector']);
    expect(result.preset?.notes.join('\n')).toContain('预设可能已过期');
  });

  it('选择器非法（count 为 null）同样视为预设可能失效', () => {
    const result = evaluatePreset(
      preset,
      [field('loggedInMarkerSelector', null, 'div[')],
      'loggedIn',
    );

    expect(result?.stale).toBe(true);
    expect(result?.staleFields.map((item) => item.key)).toEqual(['loggedInMarkerSelector']);
  });

  it('登录态无法判断时不做预设失效判定，避免误报', () => {
    const result = evaluatePreset(preset, [], 'unknown');

    expect(result?.stale).toBe(false);
    expect(result?.notes.join('\n')).toContain('未做');
  });

  it('手写配置（无预设标记）不产生预设结论', () => {
    expect(evaluatePreset(null, [], 'loggedOut')).toBeNull();
  });
});

