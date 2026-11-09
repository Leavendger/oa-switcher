/** Content Script 侧来源与上下文校验。 */

export function isTopFrame(): boolean {
  return window.top === window.self;
}

export function frameRole(): 'top' | 'sub' {
  return isTopFrame() ? 'top' : 'sub';
}

/** runId 格式校验（run_ + 12 位十六进制）。 */
export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^run_[0-9a-f]{12}$/.test(value);
}
