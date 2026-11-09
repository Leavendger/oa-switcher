import type {
  DiscoveryFieldKey,
  SelfCheckField,
  SelfCheckPresetInfo,
  SelfCheckResult,
  SelfCheckState,
} from '../../shared/types/discovery';
import { DISCOVERY_FIELD_LABELS } from '../../shared/types/discovery';
import { matchesUrlPattern } from '../../shared/urlMatch';

interface SelectorEntry {
  key: DiscoveryFieldKey;
  selector: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 从 adapterConfig 中挑出所有「选择器型」字段，用于自检逐项计数。 */
export function collectConfiguredSelectors(config: Record<string, unknown>): SelectorEntry[] {
  const entries: SelectorEntry[] = [];
  const push = (key: DiscoveryFieldKey, value: unknown): void => {
    const selector = text(value);
    if (selector.length > 0) entries.push({ key, selector });
  };

  push('loginFormReadySelector', config.loginFormReadySelector);
  push('usernameFieldSelector', config.usernameFieldSelector);
  push('passwordFieldSelector', config.passwordFieldSelector);

  const submit = isRecord(config.submitTrigger) ? config.submitTrigger : null;
  if (submit) push('submitSelector', submit.selector);

  push('loggedInMarkerSelector', config.loggedInMarkerSelector);
  push('loggedOutMarkerSelector', config.loggedOutMarkerSelector);
  push('loginFailureMarkerSelector', config.loginFailureMarkerSelector);

  const logout = isRecord(config.logoutTrigger) ? config.logoutTrigger : null;
  if (logout) {
    push('logoutSelector', logout.selector);
    push('logoutConfirmSelector', logout.confirmSelector);
  }

  return entries;
}

export interface SelfCheckEvaluationInput {
  url: string;
  fields: SelfCheckField[];
  authenticatedUrlPattern: string;
  loggedOutUrlPattern: string;
  loginPageUrlPattern: string;
}

/** 与 landray 适配器的登录态判定口径保持一致：只认证据，冲突即 unknown。 */
export function evaluateSelfCheckState(input: SelfCheckEvaluationInput): {
  state: SelfCheckState;
  notes: string[];
} {
  const notes: string[] = [];
  const hit = (key: DiscoveryFieldKey): boolean =>
    input.fields.some((field) => field.key === key && typeof field.count === 'number' && field.count > 0);

  const loggedInByUrl =
    input.authenticatedUrlPattern.length > 0 &&
    matchesUrlPattern(input.authenticatedUrlPattern, input.url);
  const loggedInByMarker = hit('loggedInMarkerSelector');
  const loggedOutByUrl =
    input.loggedOutUrlPattern.length > 0 && matchesUrlPattern(input.loggedOutUrlPattern, input.url);
  const loggedOutByLoginPage =
    input.loginPageUrlPattern.length > 0 && matchesUrlPattern(input.loginPageUrlPattern, input.url);
  const loggedOutByMarker = hit('loggedOutMarkerSelector');

  const loggedIn = loggedInByUrl || loggedInByMarker;
  const loggedOut = loggedOutByUrl || loggedOutByLoginPage || loggedOutByMarker;

  if (loggedInByUrl) notes.push(`当前 URL 命中「登录成功 URL 规则」：${input.authenticatedUrlPattern}`);
  if (loggedInByMarker) notes.push('「已登录标记」命中至少 1 个元素');
  if (loggedOutByLoginPage) notes.push(`当前 URL 命中「登录页 URL 规则」：${input.loginPageUrlPattern}`);
  if (loggedOutByUrl) notes.push(`当前 URL 命中「退出后 URL 规则」：${input.loggedOutUrlPattern}`);
  if (loggedOutByMarker) notes.push('「未登录标记」命中至少 1 个元素');

  if (loggedIn && loggedOut) {
    notes.push('已登录与未登录证据同时命中，判定为无法判断，请检查规则是否重叠');
    return { state: 'unknown', notes };
  }
  if (loggedIn) return { state: 'loggedIn', notes };
  if (loggedOut) return { state: 'loggedOut', notes };

  const hasLoggedInSignal =
    input.authenticatedUrlPattern.length > 0 || hit('loggedInMarkerSelector');
  const hasLoggedOutSignal =
    input.loggedOutUrlPattern.length > 0 ||
    input.loginPageUrlPattern.length > 0 ||
    hit('loggedOutMarkerSelector');
  if (!hasLoggedInSignal && !hasLoggedOutSignal) {
    notes.push('尚未配置任何可用的登录态判定信号');
  } else {
    notes.push('已配置的规则与标记在当前页面都没有命中');
  }
  return { state: 'unknown', notes };
}

export function buildSelfCheckResult(input: {
  url: string;
  tabId: number;
  fields: Array<{ key: DiscoveryFieldKey; selector: string; count: number | null; error: string | null }>;
  authenticatedUrlPattern: string;
  loggedOutUrlPattern: string;
  loginPageUrlPattern: string;
  preset: { id: string; version: string } | null;
}): SelfCheckResult {
  const fields: SelfCheckField[] = input.fields.map((item) => ({
    key: item.key,
    label: DISCOVERY_FIELD_LABELS[item.key],
    selector: item.selector,
    count: item.count,
    error: item.error,
  }));

  const evaluated = evaluateSelfCheckState({ ...input, fields });
  return {
    url: input.url,
    tabId: input.tabId,
    state: evaluated.state,
    fields,
    notes: evaluated.notes,
    preset: evaluatePreset(input.preset, fields, evaluated.state),
  };
}

/**
 * 「该登录态下必然存在」的预设字段。失败提示与退出二次确认只在特定交互后出现，
 * 不参与过期判定，避免把正常的 0 命中误判成预设失效。
 */
const PRESET_EXPECTED_FIELDS: Record<Exclude<SelfCheckState, 'unknown'>, readonly DiscoveryFieldKey[]> = {
  loggedOut: [
    'loginFormReadySelector',
    'usernameFieldSelector',
    'passwordFieldSelector',
    'loggedOutMarkerSelector',
  ],
  loggedIn: ['loggedInMarkerSelector', 'logoutSelector'],
};

export function evaluatePreset(
  preset: { id: string; version: string } | null,
  fields: SelfCheckField[],
  state: SelfCheckState,
): SelfCheckPresetInfo | null {
  if (!preset) return null;
  if (state === 'unknown') {
    return {
      id: preset.id,
      version: preset.version,
      stale: false,
      staleFields: [],
      notes: ['当前登录态无法判断，未做「预设是否过期」判定。'],
    };
  }

  const expected = PRESET_EXPECTED_FIELDS[state];
  const staleFields = expected.flatMap((key) => {
    const field = fields.find((item) => item.key === key);
    if (!field) return [];
    const missed = field.count === null || field.count === 0;
    return missed ? [{ key, label: field.label }] : [];
  });

  const notes: string[] = [];
  if (staleFields.length > 0) {
    notes.push(
      `预设可能已过期：${staleFields.map((item) => item.label).join('、')} 在当前页面未命中（可能是站点版本差异）。`,
    );
  } else {
    const checked = expected.filter((key) => fields.some((item) => item.key === key)).length;
    notes.push(`预设字段在当前页面均命中（检查 ${checked} 项）。`);
  }

  return {
    id: preset.id,
    version: preset.version,
    stale: staleFields.length > 0,
    staleFields,
    notes,
  };
}

