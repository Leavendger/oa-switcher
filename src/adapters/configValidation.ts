import type { AdapterConfigValidation } from './types';

/**
 * 通用必填键检查：只判断键是否存在/是否为空字符串，不解释语义。
 * 保证「未配置真实页面信息时不得虚构选择器」。
 */
export function checkRequiredKeys(
  config: unknown,
  requiredKeys: readonly string[],
): AdapterConfigValidation {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { ok: false, missing: [...requiredKeys] };
  }

  const record = config as Record<string, unknown>;
  const missing = requiredKeys.filter((key) => {
    const value = record[key];
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  });

  return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing };
}
