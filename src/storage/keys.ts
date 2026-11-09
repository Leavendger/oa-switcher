/** chrome.storage.local 的 key 唯一来源。禁止在业务代码中硬编码字符串 key。 */

export const STORAGE_PREFIX = 'oa.v1.';

export const STORAGE_KEYS = {
  meta: `${STORAGE_PREFIX}meta`,
  settings: `${STORAGE_PREFIX}settings`,
  systems: `${STORAGE_PREFIX}systems`,
  groups: `${STORAGE_PREFIX}groups`,
  accounts: `${STORAGE_PREFIX}accounts`,
  vault: `${STORAGE_PREFIX}vault`,
  audit: `${STORAGE_PREFIX}audit`,
  /** 全局开关：是否在 OA 页面渲染悬浮球（默认开启）。 */
  floatEnabled: `${STORAGE_PREFIX}float.enabled`,
  /** 站点级关闭记录：origin → true，表示该站点不再显示悬浮球。 */
  floatDismissed: `${STORAGE_PREFIX}float.dismissed`,
  /** 位置记忆：origin → { x, y }（视口内像素偏移）。 */
  floatPositions: `${STORAGE_PREFIX}float.positions`,
} as const;

export const SESSION_KEYS = {
  run: `${STORAGE_PREFIX}session.run`,
} as const;
