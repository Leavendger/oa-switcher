import { FLOW_TIMEOUTS } from '../shared/constants';

let timer: ReturnType<typeof setTimeout> | null = null;

function tick(): void {
  chrome.runtime.getPlatformInfo(() => {
    if (timer !== null) {
      timer = setTimeout(tick, FLOW_TIMEOUTS.keepaliveIntervalMs);
    }
  });
}

/** 仅在流程运行期间保活；终态立即停止。 */
export function startKeepalive(): void {
  if (timer !== null) return;
  timer = setTimeout(tick, FLOW_TIMEOUTS.keepaliveIntervalMs);
}

export function stopKeepalive(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
