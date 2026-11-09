import type { DiscoveryFieldKey } from '../../shared/types/discovery';
import type { AdapterTimeouts } from '../../shared/types/system';
import { LANDRAY_PRESET_ID, LANDRAY_PRESET_VERSION } from '../../shared/constants';
import type { LandrayAdapterConfig } from './config';

export { LANDRAY_PRESET_ID, LANDRAY_PRESET_VERSION };

/**
 * 蓝凌厂商预设。
 *
 * 设计约束：
 * - 只允许相对写法：所有 URL 规则都以 `{origin}` 占位，展开时才代入当前站点；
 *   因此本文件不包含任何具体域名 / IP，换站点无需修改。
 * - 只收录「在两个真实环境都命中」的规则（示例环境 A、示例环境 B，均为
 *   蓝凌 Acegi 登录实现）；单环境命中的规则不进入预设，改由自动识别或
 *   人工确认。
 * - 预设必然包含结构特征（选择器），这是厂商预设的存在理由；因此本文件是
 *   `scripts/check-no-selectors.mjs` 的唯一豁免文件。预设需要：可被用户逐项覆盖、
 *   可通过「自检」验证命中数量、并随站点版本变化被判定为「可能已过期」。
 */

export const PRESET_ORIGIN_PLACEHOLDER = '{origin}';

/** 预设覆盖的字段（顺序与 UI 展示一致）。退出地址不参与：本预设固定采用 click 方式。 */
export const LANDRAY_PRESET_FIELDS: readonly DiscoveryFieldKey[] = [
  'loginPageUrlPattern',
  'loginFormReadySelector',
  'usernameFieldSelector',
  'passwordFieldSelector',
  'submitKind',
  'submitSelector',
  'loggedOutMarkerSelector',
  'loggedInMarkerSelector',
  'authenticatedUrlPattern',
  'loginFailureMarkerSelector',
  'logoutKind',
  'logoutSelector',
  'logoutConfirmSelector',
  'loggedOutUrlPattern',
  'urlSignatures',
];

/**
 * 纯模板：URL 规则一律使用 `{origin}` 占位。
 * 空字符串表示该字段不提供预设值。
 */
export const LANDRAY_PRESET_TEMPLATE: Record<DiscoveryFieldKey, string> = {
  loginPageUrlPattern: '{origin}/login.jsp*',
  loginFormReadySelector: 'form[action="/j_acegi_security_check"]',
  usernameFieldSelector: 'input[name="j_username"]',
  passwordFieldSelector: 'input[name="j_password"]',
  submitKind: 'click',
  submitSelector: 'input[name="btn_submit"]',
  loggedOutMarkerSelector: 'input[name="j_username"]',
  loggedInMarkerSelector: 'div.lui_single_menu_header_logout .lui_dropdown_toggle',
  authenticatedUrlPattern: '{origin}/sys/*',
  loginFailureMarkerSelector: '.lui_login_message_div.tip_message',
  logoutKind: 'click',
  logoutUrl: '',
  logoutSelector: 'div.lui_single_menu_header_logout .lui_dropdown_toggle',
  logoutConfirmSelector: 'div.lui_dialog_main .lui_widget_btn.lui_toolbar_btn_def',
  loggedOutUrlPattern: '{origin}/login.jsp*',
  urlSignatures: '{origin}/sys/*',
};

/** 每个字段的交叉校验证据（两个环境的命中数量），用于「识别依据」与文档。 */
export const LANDRAY_PRESET_EVIDENCE: Partial<Record<DiscoveryFieldKey, string>> = {
  loginPageUrlPattern: '环境一 /login.jsp 与环境二 /login.jsp 均为登录页',
  loginFormReadySelector: '两环境登录页均命中 1 个（form action=/j_acegi_security_check）',
  usernameFieldSelector: '两环境登录页均命中 1 个（input name=j_username）',
  passwordFieldSelector: '两环境登录页均命中 1 个（input name=j_password）',
  submitKind: '两环境均存在隐藏 submit 控件，页面内 click() 可提交',
  submitSelector: '两环境登录页均命中 1 个（input name=btn_submit）',
  loggedOutMarkerSelector: '两环境登录页均命中 1 个（复用用户名输入框）',
  loggedInMarkerSelector: '两环境登录后均命中 1 个（退出图标容器）',
  authenticatedUrlPattern: '两环境登录后均处于 /sys/ 下（门户、个人资料等页面都算已登录）',
  loginFailureMarkerSelector: '两环境用不存在的账号登录后均命中 1 个「用户名或密码不正确」提示',
  logoutKind: '两环境退出均通过同一 JS 函数弹出确认框',
  logoutSelector: '两环境登录后均命中 1 个（退出图标容器）',
  logoutConfirmSelector: '两环境点击退出后确认框内「确定」按钮均命中 1 个',
  loggedOutUrlPattern: '两环境确认退出后均回到 /login.jsp',
  urlSignatures: '两环境登录后的页面都位于 /sys/ 下',
};

const PRESET_TIMEOUTS: Partial<AdapterTimeouts> = {
  stateProbeMs: 5_000,
  logoutTriggerMs: 5_000,
  logoutConfirmMs: 15_000,
  loginPageWaitMs: 15_000,
  fillMs: 3_000,
  submitMs: 5_000,
  verifyMs: 20_000,
  pollMs: 300,
};

export function expandPresetValue(value: string, origin: string): string {
  return value.split(PRESET_ORIGIN_PLACEHOLDER).join(origin);
}

/** 生成可直接填入新建表单的草稿值（已代入 origin）。 */
export function buildLandrayPresetDraft(origin: string): Partial<Record<DiscoveryFieldKey, string>> {
  const draft: Partial<Record<DiscoveryFieldKey, string>> = {};
  for (const key of LANDRAY_PRESET_FIELDS) {
    const template = LANDRAY_PRESET_TEMPLATE[key];
    if (template.length > 0) draft[key] = expandPresetValue(template, origin);
  }
  return draft;
}

export interface LandrayPresetBuild {
  config: LandrayAdapterConfig;
  urlSignatures: string[];
}

/** 生成完整 adapterConfig（含预设来源标记，供自检判断「预设可能已过期」）。 */
export function buildLandrayPresetConfig(origin: string): LandrayPresetBuild {
  const draft = buildLandrayPresetDraft(origin);
  const signatureLines = (draft.urlSignatures ?? '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    config: {
      schemaVersion: 1,
      preset: { id: LANDRAY_PRESET_ID, version: LANDRAY_PRESET_VERSION },
      loginPageUrlPattern: draft.loginPageUrlPattern,
      loginFormReadySelector: draft.loginFormReadySelector,
      usernameFieldSelector: draft.usernameFieldSelector,
      passwordFieldSelector: draft.passwordFieldSelector,
      submitTrigger: { kind: 'click', selector: draft.submitSelector ?? '' },
      loggedOutMarkerSelector: draft.loggedOutMarkerSelector,
      loggedInMarkerSelector: draft.loggedInMarkerSelector,
      authenticatedUrlPattern: draft.authenticatedUrlPattern,
      loginFailureMarkerSelector: draft.loginFailureMarkerSelector,
      logoutTrigger: {
        kind: 'click',
        selector: draft.logoutSelector ?? '',
        confirmSelector: draft.logoutConfirmSelector ?? '',
      },
      loggedOutUrlPattern: draft.loggedOutUrlPattern,
      timeouts: { ...PRESET_TIMEOUTS },
      notes: `蓝凌预设 v${LANDRAY_PRESET_VERSION}（两环境交叉校验，可逐项覆盖）`,
    },
    urlSignatures: signatureLines,
  };
}
