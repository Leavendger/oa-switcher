export interface FloatPoint {
  x: number;
  y: number;
}

/** 页面悬浮球的展示偏好（不含任何账号或凭证信息）。 */
export interface FloatPrefs {
  enabled: boolean;
  dismissed: Record<string, true>;
  positions: Record<string, FloatPoint>;
}
