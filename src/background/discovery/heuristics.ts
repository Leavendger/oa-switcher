import type {
  DiscoveryEvidence,
  DiscoveryField,
  DiscoveryFieldKey,
  DiscoveryResult,
  DiscoveryStatus,
} from '../../shared/types/discovery';
import { DISCOVERY_FIELD_LABELS, DISCOVERY_FIELD_ORDER } from '../../shared/types/discovery';
import type { OaVendor } from '../../shared/types/system';
import type { PageButtonFact, PageFacts, PageFormFact, PageInputFact } from './pageFacts';

interface Candidate {
  selector: string;
  count: number;
  source: string;
}

function quote(value: string): string | null {
  if (value.length === 0 || /["\\\n\r]/.test(value)) return null;
  return `"${value}"`;
}

function idSelector(id: string): string | null {
  if (!id) return null;
  if (/^[A-Za-z_][\w-]*$/.test(id)) return `#${id}`;
  const quoted = quote(id);
  return quoted ? `[id=${quoted}]` : null;
}

function countInputs(inputs: PageInputFact[], predicate: (input: PageInputFact) => boolean): number {
  return inputs.filter(predicate).length;
}

function inputSelector(input: PageInputFact, inputs: PageInputFact[]): Candidate | null {
  const byId = idSelector(input.id);
  if (byId && countInputs(inputs, (item) => item.id === input.id) === 1) {
    return { selector: byId, count: 1, source: 'id 属性' };
  }
  if (input.name) {
    const quoted = quote(input.name);
    if (quoted) {
      const count = countInputs(inputs, (item) => item.name === input.name);
      if (count === 1) {
        return { selector: `input[name=${quoted}]`, count, source: 'name 属性' };
      }
    }
  }
  if (input.type) {
    const quoted = quote(input.type);
    if (quoted) {
      const count = countInputs(inputs, (item) => item.type === input.type);
      return { selector: `input[type=${quoted}]`, count, source: 'type 属性' };
    }
  }
  return null;
}

function buttonSelector(button: PageButtonFact, buttons: PageButtonFact[]): Candidate | null {
  const byId = idSelector(button.id);
  if (byId && buttons.filter((item) => item.id === button.id).length === 1) {
    return { selector: byId, count: 1, source: 'id 属性' };
  }
  if (button.name) {
    const quoted = quote(button.name);
    if (quoted) {
      const tag = button.tag === 'input' ? 'input' : 'button';
      const selector = `${tag}[name=${quoted}]`;
      const count = buttons.filter((item) => item.name === button.name && item.tag === button.tag).length;
      if (count >= 1) return { selector, count, source: 'name 属性' };
    }
  }
  if (button.tag === 'button' && button.type === 'submit') {
    const count = buttons.filter((item) => item.tag === 'button' && item.type === 'submit').length;
    return { selector: 'button[type="submit"]', count, source: 'type 属性' };
  }
  if (button.tag === 'input' && button.type === 'submit') {
    const count = buttons.filter((item) => item.tag === 'input' && item.type === 'submit').length;
    return { selector: 'input[type="submit"]', count, source: 'type 属性' };
  }
  return null;
}

function formSelector(form: PageFormFact, forms: PageFormFact[]): Candidate | null {
  const byId = idSelector(form.id);
  if (byId && forms.filter((item) => item.id === form.id).length === 1) {
    return { selector: byId, count: 1, source: 'id 属性' };
  }
  if (form.action) {
    const quoted = quote(form.action);
    if (quoted) {
      const selector = `form[action=${quoted}]`;
      const count = forms.filter((item) => item.action === form.action).length;
      if (count === 1) return { selector, count, source: 'action 属性' };
    }
  }
  if (forms.length === 1) return { selector: 'form', count: 1, source: '页面唯一表单' };
  return null;
}

function field(
  key: DiscoveryFieldKey,
  value: string,
  status: DiscoveryStatus,
  evidence: DiscoveryEvidence[],
): DiscoveryField {
  return { key, label: DISCOVERY_FIELD_LABELS[key], value, status, evidence };
}

function unknown(key: DiscoveryFieldKey, reason: string): DiscoveryField {
  return field(key, '', 'unknown', [{ label: '说明', detail: reason }]);
}

function patternFromUrl(url: string): { pattern: string; broad: boolean } {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '/' : parsed.pathname;
    return {
      pattern: `${parsed.origin}${path}*`,
      broad: path === '/',
    };
  } catch {
    return { pattern: '', broad: true };
  }
}

const SUBMIT_TEXT = /登录|登入|log\s*in|sign\s*in/i;
const HOME_TEXT = /首页|门户|工作台|home|portal|main/i;
const REDIRECT_KEYS = ['redirect', 'redirecturl', 'redirect_url', 'returnurl', 'return_url', 'url', 'service', 'goto', 'target'];
const ACEGI_FIELD = /^j_(username|password|submit)$/i;

/**
 * 厂商指纹只用于「解释」，不参与生成选择器：
 * 命中也只是给用户一条提示，避免把指纹当成硬编码选择器的借口。
 */
function vendorFingerprintNotes(facts: PageFacts): string[] {
  const notes: string[] = [];
  const acegiForm = facts.forms.some((form) => (form.action ?? '').toLowerCase().includes('acegi'));
  const acegiField = facts.inputs.some((input) => ACEGI_FIELD.test(input.name));
  if (acegiForm || acegiField) {
    notes.push(
      '检测到 Acegi 表单指纹（表单 action 或字段名），与蓝凌常见实现一致；仅作提示，选择器仍以实际属性证据为准。',
    );
  }
  return notes;
}

function redirectTarget(url: string): string | null {
  try {
    const parsed = new URL(url);
    for (const key of REDIRECT_KEYS) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;
      try {
        const next = new URL(value, parsed);
        if (next.origin === parsed.origin) return next.toString();
      } catch {
        // 忽略无法解析的参数
      }
    }
  } catch {
    // 忽略非法 URL
  }
  return null;
}

/**
 * 通用启发式：只依赖表单/输入框/按钮的结构与属性，不包含任何站点特征选择器。
 * 无法从当前页面推断的字段一律标为 unknown / needs-confirmation，绝不猜测写入。
 */
export function deriveDiscoveryFields(facts: PageFacts, vendor: OaVendor): DiscoveryResult {
  const notes: string[] = vendorFingerprintNotes(facts);
  const fields = new Map<DiscoveryFieldKey, DiscoveryField>();

  const passwordInputs = facts.inputs.filter((input) => input.type === 'password');
  const visiblePasswords = passwordInputs.filter((input) => input.visible);
  const password = visiblePasswords[0] ?? passwordInputs[0] ?? null;

  const pagePattern = patternFromUrl(facts.url);
  fields.set(
    'loginPageUrlPattern',
    pagePattern.pattern
      ? field(
          'loginPageUrlPattern',
          pagePattern.pattern,
          pagePattern.broad ? 'needs-confirmation' : 'auto',
          [
            { label: '来源', detail: '页面最终 URL（去掉参数与锚点）' },
            { label: 'URL', detail: facts.url },
          ],
        )
      : unknown('loginPageUrlPattern', '页面 URL 非法，无法生成规则'),
  );
  if (pagePattern.broad) notes.push('登录页位于站点根路径，URL 规则范围较大，请确认是否收窄。');

  const loginForm = password?.formIndex != null ? facts.forms[password.formIndex] ?? null : null;
  const formCandidate = loginForm ? formSelector(loginForm, facts.forms) : null;
  fields.set(
    'loginFormReadySelector',
    formCandidate
      ? field('loginFormReadySelector', formCandidate.selector, 'auto', [
          { label: '来源', detail: formCandidate.source },
          { label: '匹配数量', detail: `${formCandidate.count} 个`, count: formCandidate.count },
        ])
      : unknown('loginFormReadySelector', '未找到包含密码输入框的表单'),
  );

  if (!password) {
    notes.push('页面上没有密码输入框，可能不是登录页或需要先跳转。');
  } else if (passwordInputs.length > 1) {
    notes.push(`页面存在 ${passwordInputs.length} 个密码输入框，已选择第一个可用的，请确认。`);
  }

  const sameFormInputs = password?.formIndex != null
    ? facts.inputs.filter((input) => input.formIndex === password.formIndex)
    : facts.inputs;
  const passwordIndex = password ? sameFormInputs.indexOf(password) : -1;
  const textInputs = sameFormInputs.filter(
    (input) => ['text', 'tel', 'email', 'number', 'search'].includes(input.type),
  );
  const beforePassword = passwordIndex >= 0
    ? textInputs.filter((input) => sameFormInputs.indexOf(input) < passwordIndex)
    : textInputs;
  const usernameInput = beforePassword[beforePassword.length - 1] ?? textInputs[0] ?? null;

  const usernameCandidate = password && usernameInput ? inputSelector(usernameInput, facts.inputs) : null;
  fields.set(
    'usernameFieldSelector',
    !password
      ? unknown('usernameFieldSelector', '页面上没有密码输入框，无法可靠定位用户名输入框')
      : usernameCandidate && usernameInput
        ? field(
            'usernameFieldSelector',
            usernameCandidate.selector,
            usernameCandidate.count === 1 ? 'auto' : 'needs-confirmation',
            [
              { label: '来源', detail: `${usernameCandidate.source}（位于密码框之前）` },
              {
                label: '匹配数量',
                detail: `${usernameCandidate.count} 个`,
                count: usernameCandidate.count,
              },
            ],
          )
        : unknown('usernameFieldSelector', '未找到密码框之前的文本输入框'),
  );

  const passwordCandidate = password ? inputSelector(password, facts.inputs) : null;
  fields.set(
    'passwordFieldSelector',
    passwordCandidate && password
      ? field(
          'passwordFieldSelector',
          passwordCandidate.selector,
          passwordCandidate.count === 1 ? 'auto' : 'needs-confirmation',
          [
            { label: '来源', detail: `${passwordCandidate.source}（type=password）` },
            {
              label: '匹配数量',
              detail: `${passwordCandidate.count} 个`,
              count: passwordCandidate.count,
            },
          ],
        )
      : unknown('passwordFieldSelector', '未找到密码输入框'),
  );

  const formButtons = facts.buttons.filter(
    (button) => button.formIndex === (loginForm?.index ?? null),
  );
  const submitButton =
    formButtons.find((button) => button.type === 'submit') ??
    formButtons.find((button) => SUBMIT_TEXT.test(button.text)) ??
    facts.buttons.find((button) => SUBMIT_TEXT.test(button.text) && button.visible) ??
    null;

  if (submitButton) {
    const candidate = buttonSelector(submitButton, facts.buttons);
    fields.set(
      'submitKind',
      field('submitKind', 'click', 'auto', [
        { label: '来源', detail: '页面内存在可提交控件，使用页面上下文 click()' },
      ]),
    );
    fields.set(
      'submitSelector',
      candidate
        ? field('submitSelector', candidate.selector, candidate.count === 1 ? 'auto' : 'needs-confirmation', [
            { label: '来源', detail: `${candidate.source}${submitButton.text ? `，文本「${submitButton.text}」` : ''}` },
            { label: '匹配数量', detail: `${candidate.count} 个`, count: candidate.count },
            { label: '可见性', detail: submitButton.visible ? '可见' : '不可见（程序化 click 仍可用）' },
          ])
        : field('submitSelector', '', 'needs-confirmation', [
            { label: '说明', detail: '找到提交控件但无法生成唯一选择器，请手工填写' },
          ]),
    );
  } else if (formCandidate) {
    fields.set(
      'submitKind',
      field('submitKind', 'formSubmit', 'needs-confirmation', [
        { label: '说明', detail: '未找到提交按钮，只能退化为表单提交（仍会触发 onsubmit）' },
      ]),
    );
    fields.set(
      'submitSelector',
      field('submitSelector', formCandidate.selector, 'needs-confirmation', [
        { label: '来源', detail: '登录表单' },
        { label: '匹配数量', detail: `${formCandidate.count} 个`, count: formCandidate.count },
      ]),
    );
  } else {
    fields.set('submitKind', unknown('submitKind', '未找到登录表单或提交控件'));
    fields.set('submitSelector', unknown('submitSelector', '未找到登录表单或提交控件'));
  }

  fields.set(
    'loggedOutMarkerSelector',
    usernameCandidate && usernameCandidate.count === 1
      ? field('loggedOutMarkerSelector', usernameCandidate.selector, 'auto', [
          { label: '来源', detail: '复用「用户名输入框」作为未登录标记' },
          { label: '匹配数量', detail: '1 个', count: 1 },
        ])
      : unknown('loggedOutMarkerSelector', '找不到稳定的未登录标记，请登录后手工确认'),
  );

  fields.set(
    'loggedInMarkerSelector',
    unknown('loggedInMarkerSelector', '未登录页面看不到已登录后的 DOM，必须登录后手工填写'),
  );

  const redirect = redirectTarget(facts.url);
  if (redirect) {
    const target = patternFromUrl(redirect);
    fields.set(
      'authenticatedUrlPattern',
      target.pattern
        ? field('authenticatedUrlPattern', target.pattern, 'auto', [
            { label: '来源', detail: 'URL 中的跳转参数' },
            { label: '跳转目标', detail: redirect },
          ])
        : unknown('authenticatedUrlPattern', '跳转参数无法解析'),
    );
  } else {
    const homeLink = facts.links.find((link) => {
      if (!HOME_TEXT.test(link.text)) return false;
      try {
        const href = new URL(link.href);
        return href.origin === new URL(facts.url).origin;
      } catch {
        return false;
      }
    });
    fields.set(
      'authenticatedUrlPattern',
      homeLink
        ? field('authenticatedUrlPattern', patternFromUrl(homeLink.href).pattern, 'needs-confirmation', [
            { label: '来源', detail: `页面链接「${homeLink.text}」` },
            { label: '链接地址', detail: homeLink.href },
          ])
        : unknown('authenticatedUrlPattern', '未发现跳转参数或首页链接，需登录后确认'),
    );
  }

  const alert = facts.alerts.find((item) => item.visible && (item.role === 'alert' || item.role === 'status'));
  fields.set(
    'loginFailureMarkerSelector',
    alert
      ? field(
          'loginFailureMarkerSelector',
          `[role="${alert.role}"]`,
          'needs-confirmation',
          [
            { label: '来源', detail: `可见的 role=${alert.role} 元素` },
            { label: '说明', detail: '错误提示通常登录失败后才出现，请确认该容器只在失败时可见' },
          ],
        )
      : unknown('loginFailureMarkerSelector', '未发现可识别的错误提示容器，需登录失败时确认'),
  );

  for (const key of ['logoutKind', 'logoutUrl', 'logoutSelector', 'logoutConfirmSelector', 'loggedOutUrlPattern'] as const) {
    fields.set(
      key,
      unknown(key, '未登录状态无法观察退出流程，必须登录后手工确认（留空不会影响从登录页发起的切换）'),
    );
  }

  const signatureLines: string[] = [];
  const loginPattern = fields.get('loginPageUrlPattern');
  if (loginPattern?.value) signatureLines.push(loginPattern.value);
  const authenticatedPattern = fields.get('authenticatedUrlPattern');
  if (authenticatedPattern?.status === 'auto' && authenticatedPattern.value) {
    signatureLines.push(authenticatedPattern.value);
  }
  fields.set(
    'urlSignatures',
    signatureLines.length > 0
      ? field('urlSignatures', signatureLines.join('\n'), 'auto', [
          { label: '来源', detail: '登录页规则' + (signatureLines.length > 1 ? ' + 跳转目标规则' : '') },
        ])
      : unknown('urlSignatures', '没有可用的 URL 规则'),
  );

  const ordered = DISCOVERY_FIELD_ORDER.map(
    (key) => fields.get(key) ?? unknown(key, '未识别'),
  );

  return {
    requestedUrl: facts.url,
    finalUrl: facts.url,
    title: facts.title,
    vendor,
    fields: ordered,
    notes,
  };
}
