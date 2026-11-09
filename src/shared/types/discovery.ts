import type { OaVendor } from './system';

/**
 * 自动识别结果的状态口径：
 * - auto：页面证据充分，可直接写入配置；
 * - needs-confirmation：有候选或只能推断，必须由用户确认/补充；
 * - unknown：当前页面无法获得任何证据（例如未登录页看不到已登录标记）。
 */
export type DiscoveryStatus = 'auto' | 'needs-confirmation' | 'unknown';

export interface DiscoveryEvidence {
  /** 证据类型，如「匹配数量」「来源属性」「页面 URL」。 */
  label: string;
  detail: string;
  count?: number;
}

export interface DiscoveryField {
  key: DiscoveryFieldKey;
  label: string;
  value: string;
  status: DiscoveryStatus;
  evidence: DiscoveryEvidence[];
}

export type DiscoveryFieldKey =
  | 'loginPageUrlPattern'
  | 'loginFormReadySelector'
  | 'usernameFieldSelector'
  | 'passwordFieldSelector'
  | 'submitKind'
  | 'submitSelector'
  | 'loggedOutMarkerSelector'
  | 'loggedInMarkerSelector'
  | 'authenticatedUrlPattern'
  | 'loginFailureMarkerSelector'
  | 'logoutKind'
  | 'logoutUrl'
  | 'logoutSelector'
  | 'logoutConfirmSelector'
  | 'loggedOutUrlPattern'
  | 'urlSignatures';

export const DISCOVERY_FIELD_LABELS: Record<DiscoveryFieldKey, string> = {
  loginPageUrlPattern: '登录页 URL 规则',
  loginFormReadySelector: '登录表单就绪标记',
  usernameFieldSelector: '用户名输入框',
  passwordFieldSelector: '密码输入框',
  submitKind: '提交方式',
  submitSelector: '提交元素',
  loggedOutMarkerSelector: '未登录标记',
  loggedInMarkerSelector: '已登录标记',
  authenticatedUrlPattern: '登录成功 URL 规则',
  loginFailureMarkerSelector: '登录失败提示',
  logoutKind: '退出方式',
  logoutUrl: '退出地址（方式为 url 时）',
  logoutSelector: '退出入口',
  logoutConfirmSelector: '退出二次确认',
  loggedOutUrlPattern: '退出后 URL 规则',
  urlSignatures: 'URL 签名',
};

/** 字段顺序即 UI 展示顺序，也用于保存时的缺项提示。 */
export const DISCOVERY_FIELD_ORDER: readonly DiscoveryFieldKey[] = [
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
  'logoutUrl',
  'logoutSelector',
  'logoutConfirmSelector',
  'loggedOutUrlPattern',
  'urlSignatures',
];

/** 这些字段无法只靠未登录页面得出，必须登录后由用户确认。 */
export const POST_LOGIN_FIELDS: readonly DiscoveryFieldKey[] = [
  'loggedInMarkerSelector',
  'logoutKind',
  'logoutUrl',
  'logoutSelector',
  'logoutConfirmSelector',
  'loggedOutUrlPattern',
];

export interface DiscoveryResult {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  vendor: OaVendor;
  fields: DiscoveryField[];
  /** 页面级说明，如「检测到多个登录表单」或「页面未出现密码输入框」。 */
  notes: string[];
}

export type SelfCheckState = 'loggedIn' | 'loggedOut' | 'unknown';

export interface SelfCheckField {
  key: DiscoveryFieldKey;
  label: string;
  selector: string;
  /** 命中数量；选择器非法时为 null。 */
  count: number | null;
  error: string | null;
}

export interface SelfCheckPresetInfo {
  id: string;
  version: string;
  /** 依据当前登录态判断：预期应命中的预设字段里有未命中的，即视为可能已过期。 */
  stale: boolean;
  staleFields: Array<{ key: DiscoveryFieldKey; label: string }>;
  notes: string[];
}

export interface SelfCheckResult {
  url: string;
  tabId: number;
  state: SelfCheckState;
  fields: SelfCheckField[];
  notes: string[];
  /** 配置来自厂商预设时提供；手写配置为 null。 */
  preset: SelfCheckPresetInfo | null;
}
