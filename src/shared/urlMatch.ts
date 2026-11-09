/**
 * URL 规则匹配与具体度打分。
 * 适配器（判断登录页/验证成功）与系统识别（按路径签名区分同域多系统）共用同一实现，
 * 避免两套规则互相漂移。
 */

/**
 * URL 规则组合器：支持 glob（* 与 ?）或完整 URL；`re:` 前缀按正则处理。
 * 未配置/空串一律不匹配，避免空规则被当作「全部命中」。
 */
export function matchesUrlPattern(pattern: string | undefined | null, url: string): boolean {
  if (typeof pattern !== 'string') return false;
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;

  if (trimmed.startsWith('re:')) {
    try {
      return new RegExp(trimmed.slice(3)).test(url);
    } catch {
      return false;
    }
  }

  const hasGlob = trimmed.includes('*') || trimmed.includes('?');
  if (!hasGlob) return url === trimmed || url.startsWith(`${trimmed}#`) || url.startsWith(`${trimmed}?`);

  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${escaped}$`).test(url);
  } catch {
    return false;
  }
}

/** 规则中的字面量长度：越长越具体，用于「最长最具体优先」。 */
export function patternSpecificity(pattern: string | undefined | null, url: string): number {
  if (typeof pattern !== 'string') return -1;
  const trimmed = pattern.trim();
  if (!matchesUrlPattern(trimmed, url)) return -1;

  if (trimmed.startsWith('re:')) {
    // 去掉正则元字符后剩余的字面量长度；纯通配的正则具体度为 0
    return trimmed
      .slice(3)
      .replace(/\\[dwsSDWbB]|[.*+?^${}()|[\]\\]/g, '')
      .trim().length;
  }

  // glob 的 * / ? 不是字面量，不计入具体度
  return trimmed.replace(/[*?]/g, '').length;
}

/** 目录前缀：/oa/login.jsp → /oa/，/login.jsp → /。用于「记住本次选择」的作用域。 */
export function directoryPrefix(pathname: string): string {
  const index = pathname.lastIndexOf('/');
  if (index <= 0) return '/';
  return pathname.slice(0, index + 1);
}
