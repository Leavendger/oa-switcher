/**
 * 全局常量：端口名、消息上限、默认超时。
 * storage key 定义在 src/storage/keys.ts；悬浮球键因内容脚本需要监听变更而放在这里共用。
 */

export const EXTENSION_NAME = 'OA Switcher';

export const STORAGE_PREFIX = 'oa.v1.';

/**
 * 悬浮球偏好键。
 * 内容脚本不能依赖 storage 层（分层约束），但需要监听这三个键的变更以即时响应开关，
 * 因此与 src/storage/keys.ts 共用同一份定义，避免字符串 key 出现两份。
 */
export const FLOAT_STORAGE_KEYS = {
  enabled: `${STORAGE_PREFIX}float.enabled`,
  dismissed: `${STORAGE_PREFIX}float.dismissed`,
  positions: `${STORAGE_PREFIX}float.positions`,
} as const;

export const PORT_NAME = 'oa-switcher:flow';

/** Options 页常开时的保活端口名；与流程端口分开，避免影响快照订阅。 */
export const UI_KEEPALIVE_PORT = 'oa-switcher:ui';

/** 流程端口断线后的重连延迟（SW 回收后端口会断开，需要重连并重拉状态）。 */
export const PORT_RECONNECT_DELAY_MS = 500;

/** 蓝凌厂商预设标识与版本：Background 的旧配置迁移和自检都需要读取。 */
export const LANDRAY_PRESET_ID = 'landray';
/** 2026-11-09.1：登录成功规则从门户页 `/sys/portal/page.jsp*` 放宽到 `/sys/*`。 */
export const LANDRAY_PRESET_VERSION = '2026-11-09.1';

export const MAX_MESSAGE_BYTES = 32 * 1024;

export const MAX_ID_LENGTH = 64;

export const MIN_MASTER_KEY_ITERATIONS = 100_000;
export const DEFAULT_MASTER_KEY_ITERATIONS = 600_000;

/** 流程级超时。 */
export const FLOW_TIMEOUTS = {
  totalMs: 90_000,
  contentPingMs: 1_500,
  sendMessageMs: 10_000,
  snapshotDebounceMs: 50,
  keepaliveIntervalMs: 20_000,
} as const;

/** 单步超时上限；实际执行时再与 90 秒总截止取最小值。 */
export const FLOW_STEP_TIMEOUTS = {
  resolve: 10_000,
  probe: 12_000,
  logout: 30_000,
  waitLoginPage: 20_000,
  fill: 12_000,
  submit: 10_000,
  verify: 30_000,
} as const;

/** 校验流程：账号/系统/凭证 */
export const LIMITS = {
  accountLabel: 32,
  username: 128,
  accountRole: 32,
  accountNote: 120,
  groupName: 24,
  systemName: 32,
  originCount: 8,
  signatureCount: 8,
  signatureLength: 512,
  masterPasswordMin: 8,
  masterPasswordMax: 128,
  accountPassword: 512,
} as const;

/** 分组颜色只允许预置色板 key，禁止存任意 CSS 值。 */
export const GROUP_COLOR_KEYS = ['blue', 'green', 'amber', 'rose', 'violet', 'slate'] as const;

export type GroupColorKey = (typeof GROUP_COLOR_KEYS)[number];

export const KEEPALIVE_ALARM = 'oa:autolock';

export const VAULT_AUTOLOCK_ALARM = 'vault:autolock';
