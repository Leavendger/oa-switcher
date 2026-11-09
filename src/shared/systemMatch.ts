import type { SystemId } from './types/ids';
import type { ActiveTabResolution, OASystem, PageKind, SystemCandidate } from './types/system';
import { directoryPrefix, patternSpecificity } from './urlMatch';

/** 活动页分类：只有 web 页面可能属于 OA 系统，其余类型一律不自动跑流程。 */
export function pageKindOf(rawUrl: string | null | undefined): PageKind {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return 'unknown';
  if (rawUrl.startsWith('chrome-extension://') || rawUrl.startsWith('moz-extension://')) {
    return 'extension';
  }
  if (/^chrome:\/\/(newtab|new-tab-page)\/?$/i.test(rawUrl) || rawUrl === 'about:newtab') {
    return 'newtab';
  }
  if (/^(chrome|edge|about|devtools|view-source):/i.test(rawUrl)) return 'browser';
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? 'web' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 系统的 URL 签名。显式配置优先；未配置时回退到登录页 / 首页地址，
 * 保证旧数据也能参与同域区分。
 */
export function systemSignatures(
  system: Pick<OASystem, 'urlSignatures' | 'loginUrl' | 'homeUrl'>,
): string[] {
  const explicit = (system.urlSignatures ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (explicit.length > 0) return explicit;

  return [system.loginUrl, system.homeUrl]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function candidateOf(system: OASystem, url: string): SystemCandidate {
  let score = -1;
  let matchedPattern: string | null = null;
  for (const signature of systemSignatures(system)) {
    const next = patternSpecificity(signature, url);
    if (next > score) {
      score = next;
      matchedPattern = next >= 0 ? signature : null;
    }
  }
  return { systemId: system.id, name: system.name, score, matchedPattern };
}

/** 在记忆选择中找最长且匹配当前 URL 的路径前缀。 */
function lookupRemembered(
  remembered: Record<string, SystemId>,
  origin: string,
  url: string,
): SystemId | null {
  let bestKey: string | null = null;
  let bestId: SystemId | null = null;
  for (const [key, systemId] of Object.entries(remembered)) {
    if (!key.startsWith(`${origin}/`)) continue;
    if (!url.startsWith(key)) continue;
    if (bestKey === null || key.length > bestKey.length) {
      bestKey = key;
      bestId = systemId;
    }
  }
  return bestId;
}

/**
 * 把当前活动页解析成系统结论。
 * - 单系统独占 origin：origin 命中即可（路径签名只用于同域多系统区分）；
 * - 同域多系统：取命中签名具体度最高者；并列时用「记住本次选择」消歧，
 *   仍不能确定则返回 ambiguous，由 Popup 让用户选择；
 * - 同域多系统但没有任何签名命中：也返回 ambiguous（页面确属该域，只是无法判定系统）。
 */
export function matchUrlToSystems(
  url: string | null | undefined,
  systems: OASystem[],
  remembered: Record<string, SystemId> = {},
): ActiveTabResolution {
  const pageKind = pageKindOf(url);
  const empty: ActiveTabResolution = {
    tabId: null,
    url: typeof url === 'string' ? url : null,
    pageKind,
    origin: null,
    status: 'none',
    systemId: null,
    basis: null,
    candidates: [],
    originSystems: [],
    rememberKey: null,
  };
  if (pageKind !== 'web' || typeof url !== 'string') return empty;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ...empty, pageKind: 'unknown' };
  }

  const origin = parsed.origin;
  const rememberKey = `${origin}${directoryPrefix(parsed.pathname)}`;
  const scoped = systems.filter((system) => system.enabled && system.origins.includes(origin));
  if (scoped.length === 0) return { ...empty, origin, rememberKey };

  const originSystems = scoped.map((system) => candidateOf(system, url));

  if (scoped.length === 1) {
    const only = originSystems[0];
    if (only) {
      return {
        ...empty,
        origin,
        rememberKey,
        status: 'matched',
        systemId: only.systemId,
        basis:
          only.matchedPattern !== null
            ? { kind: 'signature', pattern: only.matchedPattern }
            : { kind: 'origin' },
        candidates: [only],
        originSystems,
      };
    }
  }

  const matched = originSystems.filter((candidate) => candidate.matchedPattern !== null);
  if (matched.length === 0) {
    return {
      ...empty,
      origin,
      rememberKey,
      status: 'ambiguous',
      candidates: originSystems,
      originSystems,
    };
  }

  const bestScore = Math.max(...matched.map((candidate) => candidate.score));
  const top = matched.filter((candidate) => candidate.score === bestScore);

  const winner = top.length === 1 ? top[0] : undefined;
  if (winner) {
    return {
      ...empty,
      origin,
      rememberKey,
      status: 'matched',
      systemId: winner.systemId,
      basis: { kind: 'signature', pattern: winner.matchedPattern ?? undefined },
      candidates: top,
      originSystems,
    };
  }

  const rememberedId = lookupRemembered(remembered, origin, url);
  const rememberedHit = rememberedId
    ? top.find((candidate) => candidate.systemId === rememberedId)
    : undefined;
  if (rememberedHit) {
    return {
      ...empty,
      origin,
      rememberKey,
      status: 'matched',
      systemId: rememberedHit.systemId,
      basis: { kind: 'remembered' },
      candidates: top,
      originSystems,
    };
  }

  return {
    ...empty,
    origin,
    rememberKey,
    status: 'ambiguous',
    candidates: top,
    originSystems,
  };
}
