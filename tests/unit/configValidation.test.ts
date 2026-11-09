import { describe, expect, it } from 'vitest';
import { checkRequiredKeys } from '../../src/adapters/configValidation';
import { LANDRAY_REQUIRED_KEYS } from '../../src/adapters/landray/config';

describe('适配器配置必填键检查', () => {
  it('空配置返回全部必填键且顺序稳定', () => {
    const result = checkRequiredKeys({}, LANDRAY_REQUIRED_KEYS);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...LANDRAY_REQUIRED_KEYS]);
  });

  it('只缺 2 个键时 missing 恰好是这 2 个', () => {
    const config = {
      loginPageUrlPattern: '/login',
      loginFormReadySelector: '#form',
      passwordFieldSelector: '#password',
      submitTrigger: { kind: 'click', selector: '#submit' },
    };
    const result = checkRequiredKeys(config, LANDRAY_REQUIRED_KEYS);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['usernameFieldSelector', 'logoutTrigger']);
  });

  it('空字符串视为未配置', () => {
    const config = {
      loginPageUrlPattern: '   ',
      loginFormReadySelector: '#form',
      usernameFieldSelector: '#user',
      passwordFieldSelector: '#password',
      submitTrigger: { kind: 'click', selector: '#submit' },
      logoutTrigger: { kind: 'url', url: '/logout' },
    };
    const result = checkRequiredKeys(config, LANDRAY_REQUIRED_KEYS);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['loginPageUrlPattern']);
  });

  it('补齐全部键后通过', () => {
    const config = {
      loginPageUrlPattern: '/login',
      loginFormReadySelector: '#form',
      usernameFieldSelector: '#user',
      passwordFieldSelector: '#password',
      submitTrigger: { kind: 'formSubmit' },
      logoutTrigger: { kind: 'click', selector: '#logout' },
    };
    const result = checkRequiredKeys(config, LANDRAY_REQUIRED_KEYS);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
