/** chrome.storage.local 的 key 唯一来源。禁止在业务代码中硬编码字符串 key。 */

import { FLOAT_STORAGE_KEYS, STORAGE_PREFIX } from '../shared/constants';

export { STORAGE_PREFIX };

export const STORAGE_KEYS = {
  meta: `${STORAGE_PREFIX}meta`,
  settings: `${STORAGE_PREFIX}settings`,
  systems: `${STORAGE_PREFIX}systems`,
  groups: `${STORAGE_PREFIX}groups`,
  accounts: `${STORAGE_PREFIX}accounts`,
  vault: `${STORAGE_PREFIX}vault`,
  audit: `${STORAGE_PREFIX}audit`,
  /** 全局开关：是否在 OA 页面渲染悬浮球（默认开启）。 */
  floatEnabled: FLOAT_STORAGE_KEYS.enabled,
  /** 站点级关闭记录：origin → true，表示该站点不再显示悬浮球。 */
  floatDismissed: FLOAT_STORAGE_KEYS.dismissed,
  /** 位置记忆：origin → { x, y }（视口内像素偏移）。 */
  floatPositions: FLOAT_STORAGE_KEYS.positions,
} as const;

export const SESSION_KEYS = {
  run: `${STORAGE_PREFIX}session.run`,
} as const;
