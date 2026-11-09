import { describe, expect, it } from 'vitest';
import { deriveDiscoveryFields } from '../../src/background/discovery/heuristics';
import type {
  PageButtonFact,
  PageFacts,
  PageFormFact,
  PageInputFact,
} from '../../src/background/discovery/pageFacts';
import type { DiscoveryFieldKey, DiscoveryResult } from '../../src/shared/types/discovery';

const ORIGIN = 'http://oa.example.com';

function form(overrides: Partial<PageFormFact>): PageFormFact {
  return { index: 0, action: null, method: 'post', id: '', name: '', ...overrides };
}

function input(overrides: Partial<PageInputFact>): PageInputFact {
  return {
    formIndex: 0,
    type: 'text',
    name: '',
    id: '',
    placeholder: '',
    ariaLabel: '',
    autocomplete: '',
    visible: true,
    ...overrides,
  };
}

function button(overrides: Partial<PageButtonFact>): PageButtonFact {
  return { formIndex: 0, tag: 'button', type: 'button', name: '', id: '', text: '', visible: true, ...overrides };
}

function facts(overrides: Partial<PageFacts>): PageFacts {
  return {
    url: `${ORIGIN}/login.jsp`,
    title: '登录',
    readyState: 'complete',
    forms: [],
    inputs: [],
    buttons: [],
    alerts: [],
    links: [],
    ...overrides,
  };
}

function pick(result: DiscoveryResult, key: DiscoveryFieldKey) {
  const field = result.fields.find((item) => item.key === key);
  if (!field) throw new Error(`缺少字段 ${key}`);
  return field;
}

function standardLoginFacts(): PageFacts {
  return facts({
    url: `${ORIGIN}/login.jsp#system/systemview`,
    forms: [form({ action: '/j_acegi_security_check' })],
    inputs: [
      input({ name: 'j_username', id: 'username', autocomplete: 'username' }),
      input({ type: 'password', name: 'j_password', id: 'password', autocomplete: 'current-password' }),
      input({ type: 'submit', name: 'btn_submit', visible: false }),
    ],
    buttons: [
      button({ tag: 'input', type: 'submit', name: 'btn_submit', text: '登录', visible: false }),
    ],
  });
}

describe('通用识别启发式', () => {
  it('标准 Acegi 登录页：只凭属性证据还原字段，并标注指纹提示', () => {
    const result = deriveDiscoveryFields(standardLoginFacts(), 'landray');

    expect(pick(result, 'loginPageUrlPattern').value).toBe(`${ORIGIN}/login.jsp*`);
    expect(pick(result, 'loginPageUrlPattern').status).toBe('auto');
    expect(pick(result, 'loginFormReadySelector')).toMatchObject({
      value: 'form[action="/j_acegi_security_check"]',
      status: 'auto',
    });
    expect(pick(result, 'usernameFieldSelector')).toMatchObject({
      value: '#username',
      status: 'auto',
    });
    expect(pick(result, 'passwordFieldSelector')).toMatchObject({
      value: '#password',
      status: 'auto',
    });
    expect(pick(result, 'submitKind').value).toBe('click');
    expect(pick(result, 'submitSelector')).toMatchObject({
      value: 'input[name="btn_submit"]',
      status: 'auto',
    });
    expect(pick(result, 'loggedOutMarkerSelector').value).toBe('#username');

    // 未登录页面无法观察的字段必须诚实标为 unknown
    expect(pick(result, 'loggedInMarkerSelector').status).toBe('unknown');
    expect(pick(result, 'logoutKind').status).toBe('unknown');
    expect(pick(result, 'logoutUrl').status).toBe('unknown');
    expect(pick(result, 'logoutSelector').status).toBe('unknown');
    expect(pick(result, 'logoutConfirmSelector').status).toBe('unknown');
    expect(pick(result, 'loggedOutUrlPattern').status).toBe('unknown');
    expect(result.notes.join('\n')).toContain('Acegi');
  });

  it('根路径登录页：URL 规则范围过大，必须标为需人工确认', () => {
    const result = deriveDiscoveryFields(
      facts({
        url: `${ORIGIN}/`,
        forms: [form({ action: '/login' })],
        inputs: [input({ name: 'user' }), input({ type: 'password', name: 'pass' })],
        buttons: [button({ type: 'submit', text: '登录' })],
      }),
      'other',
    );

    expect(pick(result, 'loginPageUrlPattern')).toMatchObject({
      value: `${ORIGIN}/*`,
      status: 'needs-confirmation',
    });
    expect(result.notes.join('\n')).toContain('根路径');
  });

  it('没有密码输入框：不猜测用户名与表单，相关字段标记为无法识别', () => {
    const result = deriveDiscoveryFields(
      facts({ inputs: [input({ name: 'keyword' })], forms: [form({ id: 'search' })] }),
      'other',
    );

    expect(pick(result, 'passwordFieldSelector').status).toBe('unknown');
    expect(pick(result, 'usernameFieldSelector').status).toBe('unknown');
    expect(pick(result, 'loginFormReadySelector').status).toBe('unknown');
    expect(result.notes.join('\n')).toContain('没有密码输入框');
  });

  it('多个密码框：优先可见密码框，并在说明中提示确认', () => {
    const result = deriveDiscoveryFields(
      facts({
        inputs: [
          input({ type: 'password', name: 'hidden_pass', visible: false }),
          input({ type: 'password', name: 'visible_pass', visible: true }),
          input({ name: 'user' }),
        ],
        forms: [form({ action: '/login' })],
      }),
      'other',
    );

    expect(pick(result, 'passwordFieldSelector').value).toBe('input[name="visible_pass"]');
    expect(result.notes.join('\n')).toContain('2 个密码输入框');
  });

  it('URL 跳转参数可推导登录成功规则，并写入 URL 签名', () => {
    const result = deriveDiscoveryFields(
      facts({
        url: `${ORIGIN}/login.jsp?redirect=%2Fsys%2Fportal%2Fpage.jsp`,
        forms: [form({ action: '/login' })],
        inputs: [input({ name: 'user' }), input({ type: 'password', name: 'pass' })],
      }),
      'other',
    );

    expect(pick(result, 'authenticatedUrlPattern')).toMatchObject({
      value: `${ORIGIN}/sys/portal/page.jsp*`,
      status: 'auto',
    });
    expect(pick(result, 'urlSignatures').value.split('\n')).toContain(`${ORIGIN}/sys/portal/page.jsp*`);
  });

  it('只有可见错误容器时才给出失败提示候选，且必须人工确认', () => {
    const withAlert = deriveDiscoveryFields(
      facts({
        forms: [form({ action: '/login' })],
        inputs: [input({ name: 'user' }), input({ type: 'password', name: 'pass' })],
        alerts: [{ role: 'alert', id: 'msg', className: 'tip', visible: true }],
      }),
      'other',
    );
    expect(pick(withAlert, 'loginFailureMarkerSelector')).toMatchObject({
      value: '[role="alert"]',
      status: 'needs-confirmation',
    });

    const classOnly = deriveDiscoveryFields(
      facts({
        forms: [form({ action: '/login' })],
        inputs: [input({ name: 'user' }), input({ type: 'password', name: 'pass' })],
        alerts: [{ role: '', id: 'msg', className: 'tip_message', visible: true }],
      }),
      'other',
    );
    expect(pick(classOnly, 'loginFailureMarkerSelector').status).toBe('unknown');
  });

  it('有提交控件但无法生成唯一选择器时不写猜测值', () => {
    const result = deriveDiscoveryFields(
      facts({
        forms: [form({ action: '/login' })],
        inputs: [input({ name: 'user' }), input({ type: 'password', name: 'pass' })],
        buttons: [button({ tag: 'button', type: 'button', text: '登录' })],
      }),
      'other',
    );

    expect(pick(result, 'submitKind').value).toBe('click');
    expect(pick(result, 'submitSelector')).toMatchObject({
      value: '',
      status: 'needs-confirmation',
    });
  });
});
