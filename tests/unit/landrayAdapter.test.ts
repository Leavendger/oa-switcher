import { describe, expect, it } from 'vitest';
import { LandrayAdapter } from '../../src/adapters/landray/adapter';
import { LANDRAY_REQUIRED_KEYS } from '../../src/adapters/landray/config';
import type { AdapterContext, PageDriver } from '../../src/adapters/types';
import { FlowError } from '../../src/shared/types/errors';
import { DEFAULT_ADAPTER_TIMEOUTS, type AdapterTimeouts } from '../../src/shared/types/system';

/** 假页面驱动：所有选择器均为占位值，不代表任何真实 OA 页面。 */
class FakeDriver implements PageDriver {
  currentUrl: string;
  readonly present = new Set<string>();
  readonly clicks: string[] = [];
  readonly values: { selector: string; value: string }[] = [];
  readonly submits: string[] = [];
  readonly navigations: string[] = [];
  readonly failSetValueFor = new Set<string>();
  onSleep: (() => void) | null = null;
  sleepCount = 0;

  private readonly registry = new Map<Element, string>();

  constructor(url = 'https://oa.example.com/login', present: readonly string[] = []) {
    this.currentUrl = url;
    for (const selector of present) this.present.add(selector);
  }

  url(): string {
    return this.currentUrl;
  }

  title(): string {
    return 'fake-oa';
  }

  query<T extends Element>(selector: string): T | null {
    return this.present.has(selector) ? this.make<T>(selector) : null;
  }

  queryAll<T extends Element>(selector: string): T[] {
    return this.present.has(selector) ? [this.make<T>(selector)] : [];
  }

  async waitFor<T extends Element>(
    selector: string,
    options: {
      timeoutMs: number;
      signal: AbortSignal;
      timeoutCode?: 'E_TIMEOUT' | 'E_LOGIN_PAGE_TIMEOUT';
    },
  ): Promise<T> {
    if (options.signal.aborted) throw new FlowError('E_CANCELLED');
    if (this.present.has(selector)) return this.make<T>(selector);
    throw new FlowError(options.timeoutCode ?? 'E_TIMEOUT', { step: 'waitFor', field: selector });
  }

  async waitUntil(
    predicate: () => boolean,
    options: { timeoutMs: number; pollMs: number; signal: AbortSignal },
  ): Promise<void> {
    if (options.signal.aborted) throw new FlowError('E_CANCELLED');
    if (predicate()) return;
    throw new FlowError('E_TIMEOUT', { step: 'waitUntil' });
  }

  async click(element: Element): Promise<void> {
    const selector = this.registry.get(element);
    if (!selector) throw new FlowError('E_FORM_NOT_FOUND', { field: 'element' });
    this.clicks.push(selector);
  }

  async setValue(element: Element, value: string): Promise<void> {
    const selector = this.registry.get(element);
    if (!selector) throw new FlowError('E_FILL_FAILED', { field: 'value' });
    if (this.failSetValueFor.has(selector)) {
      throw new FlowError('E_FILL_FAILED', { field: 'value' });
    }
    this.values.push({ selector, value });
  }

  async submitForm(element: Element): Promise<void> {
    const selector = this.registry.get(element);
    if (!selector) throw new FlowError('E_SUBMIT_FAILED', { field: 'submit' });
    this.submits.push(selector);
  }

  async navigate(url: string): Promise<void> {
    this.navigations.push(url);
    this.currentUrl = url;
  }

  async sleep(): Promise<void> {
    this.sleepCount += 1;
    await Promise.resolve();
    this.onSleep?.();
  }

  private make<T extends Element>(selector: string): T {
    const element = { selector } as unknown as Element;
    this.registry.set(element, selector);
    return element as T;
  }
}

function makeContext(
  driver: FakeDriver,
  config: Record<string, unknown>,
  overrides: Partial<AdapterTimeouts> = {},
): AdapterContext {
  return {
    driver,
    config,
    timeouts: { ...DEFAULT_ADAPTER_TIMEOUTS, ...overrides },
    signal: new AbortController().signal,
  };
}

const BASE_CONFIG: Record<string, unknown> = {
  loginPageUrlPattern: 'https://oa.example.com/login*',
  loginFormReadySelector: '#login-form',
  usernameFieldSelector: '#username',
  passwordFieldSelector: '#password',
  submitTrigger: { kind: 'click', selector: '#submit' },
  loggedInMarkerSelector: '#logged-in',
  loggedOutMarkerSelector: '#logged-out',
  authenticatedUrlPattern: 'https://oa.example.com/home*',
  loginFailureMarkerSelector: '#login-error',
  logoutTrigger: { kind: 'click', selector: '#logout' },
  loggedOutUrlPattern: 'https://oa.example.com/login*',
};

describe('LandrayAdapter.validateConfig', () => {
  it('空配置返回全部必填键', () => {
    const adapter = new LandrayAdapter({});
    const result = adapter.validateConfig({});
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...LANDRAY_REQUIRED_KEYS]);
  });
});

describe('detectLoginPage', () => {
  it('缺少登录页配置时报 E_CONFIG_MISSING 并指明键名', async () => {
    const adapter = new LandrayAdapter({});
    const context = makeContext(new FakeDriver(), {});
    await expect(adapter.detectLoginPage(context)).rejects.toMatchObject({
      code: 'E_CONFIG_MISSING',
      detail: { field: 'adapterConfig', missing: 'loginPageUrlPattern' },
    });
  });

  it('URL 与表单就绪标记同时命中时返回 true/true', async () => {
    const driver = new FakeDriver('https://oa.example.com/login', ['#login-form']);
    const adapter = new LandrayAdapter(BASE_CONFIG);
    await expect(adapter.detectLoginPage(makeContext(driver, BASE_CONFIG))).resolves.toEqual({
      isLoginPage: true,
      formReady: true,
    });
  });
});

describe('detectLoginState', () => {
  it('已登录标记命中返回 loggedIn', async () => {
    const driver = new FakeDriver('https://oa.example.com/home', ['#logged-in']);
    const adapter = new LandrayAdapter(BASE_CONFIG);
    const report = await adapter.detectLoginState(makeContext(driver, BASE_CONFIG));
    expect(report.state).toBe('loggedIn');
    expect(report.evidence).toEqual([
      { kind: 'loggedInMarker', detail: { selector: '#logged-in' } },
    ]);
  });

  it('未登录标记命中返回 loggedOut', async () => {
    const driver = new FakeDriver('https://oa.example.com/home', ['#logged-out']);
    const adapter = new LandrayAdapter(BASE_CONFIG);
    const report = await adapter.detectLoginState(makeContext(driver, BASE_CONFIG));
    expect(report.state).toBe('loggedOut');
  });

  it('登录页 URL 规则命中即视为 loggedOut', async () => {
    const driver = new FakeDriver('https://oa.example.com/login');
    const adapter = new LandrayAdapter({ loginPageUrlPattern: 'https://oa.example.com/login*' });
    const report = await adapter.detectLoginState(
      makeContext(driver, { loginPageUrlPattern: 'https://oa.example.com/login*' }),
    );
    expect(report.state).toBe('loggedOut');
    expect(report.evidence).toEqual([
      { kind: 'loginPageUrl', detail: { pattern: 'https://oa.example.com/login*' } },
    ]);
  });

  it('登录/未登录证据冲突时返回 unknown 并记录 conflict', async () => {
    const driver = new FakeDriver('https://oa.example.com/home', ['#logged-in', '#logged-out']);
    const adapter = new LandrayAdapter(BASE_CONFIG);
    const report = await adapter.detectLoginState(makeContext(driver, BASE_CONFIG));
    expect(report.state).toBe('unknown');
    expect(report.evidence.some((item) => item.kind === 'conflict')).toBe(true);
  });

  it('没有任何登录态判定配置时立即报 E_CONFIG_MISSING，不消耗探测窗口', async () => {
    const driver = new FakeDriver('https://oa.example.com/unknown');
    const adapter = new LandrayAdapter({});
    await expect(
      adapter.detectLoginState(makeContext(driver, {}, { stateProbeMs: 5_000 })),
    ).rejects.toMatchObject({
      code: 'E_CONFIG_MISSING',
      detail: {
        field: 'adapterConfig',
        missing: 'loggedInMarkerSelector,loggedOutMarkerSelector,loginPageUrlPattern',
      },
    });
    expect(driver.sleepCount).toBe(0);
  });

  it('有判定配置但无证据且探测窗口为 0 时返回 unknown', async () => {
    const config = {
      loginPageUrlPattern: 'https://oa.example.com/login*',
      loggedInMarkerSelector: '#logged-in',
    };
    const driver = new FakeDriver('https://oa.example.com/unknown');
    const adapter = new LandrayAdapter(config);
    const report = await adapter.detectLoginState(makeContext(driver, config, { stateProbeMs: 0 }));
    expect(report.state).toBe('unknown');
    expect(report.evidence).toEqual([]);
  });
});

describe('detectBlockers', () => {
  it('验证码标记命中返回 captcha', async () => {
    const driver = new FakeDriver('https://oa.example.com/login', ['#captcha']);
    const adapter = new LandrayAdapter({ captchaMarkerSelector: '#captcha' });
    await expect(
      adapter.detectBlockers(makeContext(driver, { captchaMarkerSelector: '#captcha' })),
    ).resolves.toEqual({ blockedBy: 'captcha' });
  });

  it('MFA 标记命中返回 mfa', async () => {
    const driver = new FakeDriver('https://oa.example.com/login', ['#mfa']);
    const adapter = new LandrayAdapter({ mfaMarkerSelector: '#mfa' });
    await expect(
      adapter.detectBlockers(makeContext(driver, { mfaMarkerSelector: '#mfa' })),
    ).resolves.toEqual({ blockedBy: 'mfa' });
  });

  it('未配置或不命中时返回 null', async () => {
    const driver = new FakeDriver('https://oa.example.com/login', ['#captcha']);
    const adapter = new LandrayAdapter({});
    await expect(adapter.detectBlockers(makeContext(driver, {}))).resolves.toEqual({
      blockedBy: null,
    });
  });
});

describe('logout', () => {
  it('url 方式导航并等待登出证据', async () => {
    const config = {
      logoutTrigger: { kind: 'url', url: 'https://oa.example.com/logout' },
      loggedOutMarkerSelector: '#logged-out',
    };
    const driver = new FakeDriver('https://oa.example.com/home', ['#logged-out']);
    const adapter = new LandrayAdapter(config);
    await adapter.logout(makeContext(driver, config));
    expect(driver.navigations).toEqual(['https://oa.example.com/logout']);
  });

  it('click 方式点击退出入口并处理二次确认', async () => {
    const config = {
      logoutTrigger: { kind: 'click', selector: '#logout', confirmSelector: '#logout-confirm' },
      loggedOutMarkerSelector: '#logged-out',
    };
    const driver = new FakeDriver('https://oa.example.com/home', [
      '#logout',
      '#logout-confirm',
      '#logged-out',
    ]);
    const adapter = new LandrayAdapter(config);
    await adapter.logout(makeContext(driver, config));
    expect(driver.clicks).toEqual(['#logout', '#logout-confirm']);
  });

  it('缺少退出配置时抛出 E_CONFIG_MISSING', async () => {
    const adapter = new LandrayAdapter({});
    await expect(adapter.logout(makeContext(new FakeDriver(), {}))).rejects.toMatchObject({
      code: 'E_CONFIG_MISSING',
      detail: { missing: 'logoutTrigger' },
    });
  });

  it('退出入口等待超时映射为 E_LOGOUT_TRIGGER_FAILED', async () => {
    const config = { logoutTrigger: { kind: 'click', selector: '#logout' } };
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.logout(makeContext(new FakeDriver(), config, { logoutTriggerMs: 0 })),
    ).rejects.toMatchObject({ code: 'E_LOGOUT_TRIGGER_FAILED' });
  });

  it('触发成功但无登出证据时抛出 E_LOGOUT_TIMEOUT', async () => {
    const config = {
      logoutTrigger: { kind: 'click', selector: '#logout' },
      loggedOutUrlPattern: 'https://oa.example.com/never*',
    };
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.logout(makeContext(new FakeDriver('https://oa.example.com/home', ['#logout']), config, {
        logoutConfirmMs: 0,
      })),
    ).rejects.toMatchObject({ code: 'E_LOGOUT_TIMEOUT' });
  });

  it('等待登出期间出现 MFA 标记直接中止', async () => {
    const config = {
      logoutTrigger: { kind: 'click', selector: '#logout' },
      loggedOutUrlPattern: 'https://oa.example.com/never*',
      mfaMarkerSelector: '#mfa',
    };
    const driver = new FakeDriver('https://oa.example.com/home', ['#logout', '#mfa']);
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.logout(makeContext(driver, config, { logoutConfirmMs: 100 })),
    ).rejects.toMatchObject({ code: 'E_BLOCKED_MFA' });
  });
});

describe('waitForLoginPage', () => {
  it('URL 与表单就绪后返回', async () => {
    const driver = new FakeDriver('https://oa.example.com/login', ['#login-form']);
    const adapter = new LandrayAdapter(BASE_CONFIG);
    await expect(
      adapter.waitForLoginPage(makeContext(driver, BASE_CONFIG)),
    ).resolves.toBeUndefined();
  });

  it('等待窗口内未就绪时抛出 E_LOGIN_PAGE_TIMEOUT', async () => {
    const driver = new FakeDriver('https://oa.example.com/home');
    const adapter = new LandrayAdapter(BASE_CONFIG);
    await expect(
      adapter.waitForLoginPage(makeContext(driver, BASE_CONFIG, { loginPageWaitMs: 0 })),
    ).rejects.toMatchObject({ code: 'E_LOGIN_PAGE_TIMEOUT' });
  });

  it('登录页出现验证码标记时抛出 E_BLOCKED_CAPTCHA', async () => {
    const config = { ...BASE_CONFIG, captchaMarkerSelector: '#captcha' };
    const driver = new FakeDriver('https://oa.example.com/home', ['#captcha']);
    const adapter = new LandrayAdapter(config);
    await expect(adapter.waitForLoginPage(makeContext(driver, config))).rejects.toMatchObject({
      code: 'E_BLOCKED_CAPTCHA',
    });
  });
});

describe('fillCredentials', () => {
  it('缺少字段选择器时抛出 E_CONFIG_MISSING', async () => {
    const adapter = new LandrayAdapter({});
    await expect(
      adapter.fillCredentials(makeContext(new FakeDriver(), {}), { username: 'u', password: 'p' }),
    ).rejects.toMatchObject({ code: 'E_CONFIG_MISSING', detail: { missing: 'usernameFieldSelector' } });
  });

  it('字段不存在时抛出 E_FORM_NOT_FOUND', async () => {
    const config = { usernameFieldSelector: '#username', passwordFieldSelector: '#password' };
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.fillCredentials(makeContext(new FakeDriver('https://oa.example.com/login'), config), {
        username: 'u',
        password: 'p',
      }),
    ).rejects.toMatchObject({ code: 'E_FORM_NOT_FOUND', detail: { field: 'username' } });
  });

  it('写入失败时抛出 E_FILL_FAILED 并指明字段', async () => {
    const config = { usernameFieldSelector: '#username', passwordFieldSelector: '#password' };
    const driver = new FakeDriver('https://oa.example.com/login', ['#username', '#password']);
    driver.failSetValueFor.add('#password');
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.fillCredentials(makeContext(driver, config), { username: 'u', password: 'p' }),
    ).rejects.toMatchObject({ code: 'E_FILL_FAILED', detail: { field: 'password' } });
  });

  it('成功时按用户名、密码顺序写入且不提交', async () => {
    const config = { usernameFieldSelector: '#username', passwordFieldSelector: '#password' };
    const driver = new FakeDriver('https://oa.example.com/login', ['#username', '#password']);
    const adapter = new LandrayAdapter(config);
    await adapter.fillCredentials(makeContext(driver, config), { username: 'alice', password: 'secret' });
    expect(driver.values).toEqual([
      { selector: '#username', value: 'alice' },
      { selector: '#password', value: 'secret' },
    ]);
    expect(driver.submits).toEqual([]);
  });
});

describe('fillCredentials 取消', () => {
  it('字段之间收到 abort 时停止写入，不把密码写入半填表单', async () => {
    const config = { usernameFieldSelector: '#username', passwordFieldSelector: '#password' };
    const driver = new FakeDriver('https://oa.example.com/login', ['#username', '#password']);
    const controller = new AbortController();
    const original = driver.setValue.bind(driver);
    driver.setValue = async (element, value) => {
      await original(element, value);
      controller.abort();
    };
    const adapter = new LandrayAdapter(config);

    await expect(
      adapter.fillCredentials(
        { ...makeContext(driver, config), signal: controller.signal },
        { username: 'alice', password: 'secret' },
      ),
    ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    expect(driver.values).toEqual([{ selector: '#username', value: 'alice' }]);
  });
});

describe('clearCredentials', () => {
  it('清空已配置且存在的用户名/密码字段', async () => {
    const config = { usernameFieldSelector: '#username', passwordFieldSelector: '#password' };
    const driver = new FakeDriver('https://oa.example.com/login', ['#username', '#password']);
    const adapter = new LandrayAdapter(config);

    await adapter.clearCredentials?.(makeContext(driver, config));
    expect(driver.values).toEqual([
      { selector: '#username', value: '' },
      { selector: '#password', value: '' },
    ]);
  });

  it('选择器未配置或字段不存在时静默跳过', async () => {
    const adapter = new LandrayAdapter({});
    const driver = new FakeDriver('https://oa.example.com/login');
    await expect(adapter.clearCredentials?.(makeContext(driver, {}))).resolves.toBeUndefined();
    expect(driver.values).toEqual([]);
  });
});

describe('submitLogin', () => {
  it('click 方式点击提交元素', async () => {
    const config = { submitTrigger: { kind: 'click', selector: '#submit' } };
    const driver = new FakeDriver('https://oa.example.com/login', ['#submit']);
    const adapter = new LandrayAdapter(config);
    await adapter.submitLogin(makeContext(driver, config));
    expect(driver.clicks).toEqual(['#submit']);
  });

  it('formSubmit 方式在表单上提交', async () => {
    const config = { submitTrigger: { kind: 'formSubmit', selector: '#submit' } };
    const driver = new FakeDriver('https://oa.example.com/login', ['#submit']);
    const adapter = new LandrayAdapter(config);
    await adapter.submitLogin(makeContext(driver, config));
    expect(driver.submits).toEqual(['#submit']);
  });

  it('缺少提交配置时抛出 E_CONFIG_MISSING', async () => {
    const adapter = new LandrayAdapter({});
    await expect(adapter.submitLogin(makeContext(new FakeDriver(), {}))).rejects.toMatchObject({
      code: 'E_CONFIG_MISSING',
      detail: { missing: 'submitTrigger' },
    });
  });

  it('提交元素等待超时映射为 E_SUBMIT_FAILED，并保留底层 reason', async () => {
    const config = { submitTrigger: { kind: 'click', selector: '#submit' } };
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.submitLogin(makeContext(new FakeDriver(), config, { submitMs: 0 })),
    ).rejects.toMatchObject({
      code: 'E_SUBMIT_FAILED',
      detail: { step: 'submit', reason: 'E_TIMEOUT' },
    });
  });

  it('提交元素选择器非法时原样抛出 E_CONFIG_MISSING，不伪装成提交失败', async () => {
    const config = { submitTrigger: { kind: 'click', selector: 'click/input[name="btn_submit"]' } };
    const driver = new FakeDriver();
    driver.waitFor = async () => {
      throw new FlowError('E_CONFIG_MISSING', {
        field: 'adapterConfig',
        reason: 'invalid-selector',
      });
    };
    const adapter = new LandrayAdapter(config);
    await expect(adapter.submitLogin(makeContext(driver, config))).rejects.toMatchObject({
      code: 'E_CONFIG_MISSING',
      detail: { reason: 'invalid-selector' },
    });
  });
});

describe('verifyLogin', () => {
  it('无任何成功/失败判定配置时抛出 E_CONFIG_MISSING', async () => {
    const adapter = new LandrayAdapter({});
    await expect(
      adapter.verifyLogin(makeContext(new FakeDriver(), {}), { deadlineAt: 0 }),
    ).rejects.toMatchObject({
      code: 'E_CONFIG_MISSING',
      detail: { missing: 'loginFailureMarkerSelector,authenticatedUrlPattern,loggedInMarkerSelector' },
    });
  });

  it('失败标记优先于成功证据', async () => {
    const config = {
      loginFailureMarkerSelector: '#login-error',
      authenticatedUrlPattern: 'https://oa.example.com/home*',
      loggedInMarkerSelector: '#logged-in',
    };
    const driver = new FakeDriver('https://oa.example.com/home', ['#login-error']);
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.verifyLogin(makeContext(driver, config), { deadlineAt: Date.now() + 100 }),
    ).resolves.toMatchObject({
      outcome: 'failure',
      evidence: [{ kind: 'failureMarker', detail: { selector: '#login-error' } }],
    });
  });

  it('成功 URL 规则命中返回 success', async () => {
    const config = { authenticatedUrlPattern: 'https://oa.example.com/home*' };
    const driver = new FakeDriver('https://oa.example.com/home');
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.verifyLogin(makeContext(driver, config), { deadlineAt: Date.now() + 100 }),
    ).resolves.toMatchObject({
      outcome: 'success',
      evidence: [{ kind: 'authenticatedUrl', detail: { pattern: config.authenticatedUrlPattern } }],
    });
  });

  it('已登录标记命中返回 success', async () => {
    const config = { loggedInMarkerSelector: '#logged-in' };
    const driver = new FakeDriver('https://oa.example.com/home', ['#logged-in']);
    const adapter = new LandrayAdapter(config);
    await expect(
      adapter.verifyLogin(makeContext(driver, config), { deadlineAt: Date.now() + 100 }),
    ).resolves.toMatchObject({ outcome: 'success' });
  });

  it('到达 deadline 仍无证据时返回 unknown，不默认成功', async () => {
    const config = { authenticatedUrlPattern: 'https://oa.example.com/home*' };
    const driver = new FakeDriver('https://oa.example.com/login');
    const adapter = new LandrayAdapter(config);
    await expect(adapter.verifyLogin(makeContext(driver, config), { deadlineAt: 0 })).resolves.toEqual({
      outcome: 'unknown',
      evidence: [],
    });
  });
});
