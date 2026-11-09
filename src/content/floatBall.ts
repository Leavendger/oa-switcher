import { describeError, errorText } from '../errors/messages.zh-CN';
import { FLOAT_STORAGE_KEYS } from '../shared/constants';
import { log } from '../shared/log';
import { callBackground, connectFlowPort } from '../shared/messaging/client';
import type { Account } from '../shared/types/account';
import {
  FLOW_STATE_LABELS,
  FLOW_STEP_LABELS,
  isTerminalFlowState,
  type FlowStateSnapshot,
} from '../shared/types/flow';
import type { AccountId } from '../shared/types/ids';
import type { OASystem } from '../shared/types/system';
import type { FloatPoint } from '../shared/types/ui';

const HOST_ID = 'oa-switcher-float-root';
const BALL_SIZE = 44;
const MARGIN = 8;
const PANEL_WIDTH = 300;
const DRAG_THRESHOLD = 4;
/** 距视口左右边缘不足该距离时，松手吸附贴边。只做水平方向。 */
const SNAP_THRESHOLD = 24;

export interface BallViewport {
  width: number;
  height: number;
}

/** 把悬浮球位置限制在视口内；视口小于球体时贴左上角。 */
export function clampBallPoint(
  point: FloatPoint,
  viewport: BallViewport,
  size = BALL_SIZE,
  margin = MARGIN,
): FloatPoint {
  const maxX = Math.max(margin, viewport.width - size - margin);
  const maxY = Math.max(margin, viewport.height - size - margin);
  return {
    x: Math.min(Math.max(point.x, margin), maxX),
    y: Math.min(Math.max(point.y, margin), maxY),
  };
}

/**
 * 收起态球内缩写（球只有 44px，放不下全名）：
 * - 含两个及以上汉字时取前两个汉字，例如「苏州创元科创 OA（蓝凌）」→「苏州」
 * - 只有一个汉字时直接使用该字
 * - 不含汉字时取前三个字母/数字并转大写，例如「Slack」→「SLA」
 * - 都没有时回退到「OA」，避免出现空球
 */
export function ballAbbreviation(name: string): string {
  const text = name.trim();
  const han = [...text].filter((char) => /[\u4e00-\u9fff]/.test(char));
  if (han.length >= 2) return han.slice(0, 2).join('');
  if (han.length === 1) return han[0] as string;

  const latin = text.replace(/[^A-Za-z0-9]/g, '').slice(0, 3);
  return latin ? latin.toUpperCase() : 'OA';
}

/** 拖动结束时的贴边吸附：只判定左右两侧，不改变纵向位置。 */
export function snapBallPoint(
  point: FloatPoint,
  viewport: BallViewport,
  size = BALL_SIZE,
  margin = MARGIN,
  threshold = SNAP_THRESHOLD,
): FloatPoint {
  const clamped = clampBallPoint(point, viewport, size, margin);
  const gapToRight = viewport.width - (clamped.x + size);
  if (clamped.x <= margin + threshold) return { x: margin, y: clamped.y };
  if (gapToRight <= margin + threshold) {
    return { x: Math.max(margin, viewport.width - size - margin), y: clamped.y };
  }
  return clamped;
}

const STYLES = `
  :host { all: initial; }
  .wrap { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
  .ball, .panel { pointer-events: auto; box-sizing: border-box; }
  .ball {
    position: fixed; width: 44px; height: 44px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.25); cursor: grab;
    background: #1f6feb; color: #fff;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 18px rgba(0,0,0,0.28); touch-action: none; user-select: none;
    padding: 0; line-height: 1; font-family: inherit;
    transition: background-color 120ms ease;
  }
  .ball:hover { background: #1a62d6; }
  .ball:active { background: #0b4fbe; }
  .ball:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .ball[aria-expanded="true"] { background: #0b4fbe; }
  .ball-name { font-size: 16px; font-weight: 700; letter-spacing: 0.02em; }
  .panel {
    position: fixed; width: 300px; max-height: 70vh; overflow: auto;
    background: #ffffff; color: #111827; border-radius: 10px;
    border: 1px solid rgba(0,0,0,0.12); box-shadow: 0 10px 32px rgba(0,0,0,0.24);
    padding: 10px; font-size: 12px; color-scheme: light;
  }
  .panel[hidden] { display: none; }
  .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .panel-title { margin: 0; font-size: 13px; font-weight: 600; }
  .panel-sub { margin: 2px 0 0; font-size: 10px; color: #6b7280; }
  .dismiss { border: none; background: transparent; color: #6b7280; cursor: pointer;
    font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
  .dismiss:hover { background: #f3f4f6; }
  .accounts { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
  .account { display: flex; flex-direction: column; gap: 1px; text-align: left; width: 100%;
    border: 1px solid #e5e7eb; background: #fff; border-radius: 6px; padding: 5px 8px;
    cursor: pointer; font-family: inherit; color: inherit; }
  .account[aria-pressed="true"] { border-color: #1f6feb; background: rgba(31,111,235,0.08); }
  .account-label { font-size: 12px; }
  .account-user { font-size: 10px; color: #6b7280; }
  .empty { margin: 0; font-size: 11px; color: #6b7280; }
  .notice { margin: 4px 0; font-size: 11px; color: #b91c1c; }
  .switch { width: 100%; border: none; border-radius: 6px; background: #1f6feb; color: #fff;
    padding: 7px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
  .switch:disabled { background: #9ca3af; cursor: not-allowed; }
  .flow { margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
  .flow p { margin: 0; font-size: 11px; }
  .flow-state { font-size: 12px; }
  .flow-step, .flow-meta { color: #6b7280; font-size: 10px; }
  .flow-error { color: #b91c1c; }
  .flow-actions { display: flex; gap: 6px; margin-top: 6px; }
  .flow-actions button { border: 1px solid #e5e7eb; background: #fff; border-radius: 6px;
    padding: 4px 8px; font-size: 11px; cursor: pointer; font-family: inherit; color: inherit; }
  .flow-actions button[hidden] { display: none; }
`;

/** 悬浮球实例句柄：由 startFloatingBall 在开关变化时调用，彻底移除 DOM 与监听。 */
export interface FloatBallHandle {
  unmount: () => void;
}

/**
 * 仅当「当前页面确实属于某个已配置并启用的系统」时渲染悬浮球。
 * 任何不满足条件的分支都直接返回，不创建容器节点，避免页面留下空 div。
 */
export async function mountFloatingBall(): Promise<FloatBallHandle | null> {
  if (document.getElementById(HOST_ID)) return null;

  const origin = location.origin;

  let prefs;
  try {
    prefs = await callBackground('ui.getFloatPrefs', {});
  } catch {
    return null;
  }
  if (!prefs.enabled) return null;
  if (prefs.dismissed[origin]) return null;

  let system: OASystem | null = null;
  try {
    const resolution = await callBackground('system.resolveForUrl', { url: location.href });
    if (resolution.status !== 'matched' || !resolution.systemId) return null;
    const systems = await callBackground('system.list', {});
    system = systems.find((item) => item.id === resolution.systemId) ?? null;
  } catch {
    return null;
  }
  if (!system || !system.enabled) return null;
  // 脚本能运行说明通常已授权；这里只排除明确记录的 denied，避免旧数据（缺 originPermissions）被误判
  if (system.originPermissions?.[origin] === 'denied') return null;

  const saved = prefs.positions[origin];
  let point = clampBallPoint(
    saved ?? { x: window.innerWidth - BALL_SIZE - 16, y: Math.round(window.innerHeight * 0.55) },
    { width: window.innerWidth, height: window.innerHeight },
  );

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${STYLES}</style>
    <div class="wrap">
      <button class="ball" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="OA 账号切换">
        <span class="ball-name" aria-hidden="true"></span>
      </button>
      <section class="panel" role="dialog" aria-label="OA 账号切换面板" hidden>
        <header class="panel-head">
          <div>
            <p class="panel-title"></p>
            <p class="panel-sub"></p>
          </div>
          <button class="dismiss" type="button" title="关闭账号列表" aria-label="关闭账号列表">×</button>
        </header>
        <div class="accounts"></div>
        <p class="notice" hidden></p>
        <button class="switch" type="button">切换账号</button>
        <div class="flow" hidden>
          <p class="flow-state"></p>
          <p class="flow-step"></p>
          <p class="flow-error" hidden></p>
          <p class="flow-meta"></p>
          <div class="flow-actions">
            <button class="cancel" type="button">取消切换</button>
            <button class="retry" type="button" hidden>重试</button>
          </div>
        </div>
      </section>
    </div>
  `;

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = shadow.querySelector<T>(selector);
    if (!element) throw new Error(`float-ball-missing ${selector}`);
    return element;
  };

  const ball = query<HTMLButtonElement>('.ball');
  const ballName = query<HTMLElement>('.ball-name');
  const panel = query<HTMLElement>('.panel');
  const panelTitle = query<HTMLElement>('.panel-title');
  const panelSub = query<HTMLElement>('.panel-sub');
  const dismissButton = query<HTMLButtonElement>('.dismiss');
  const accountsBox = query<HTMLElement>('.accounts');
  const notice = query<HTMLElement>('.notice');
  const switchButton = query<HTMLButtonElement>('.switch');
  const flowBox = query<HTMLElement>('.flow');
  const flowState = query<HTMLElement>('.flow-state');
  const flowStep = query<HTMLElement>('.flow-step');
  const flowError = query<HTMLElement>('.flow-error');
  const flowMeta = query<HTMLElement>('.flow-meta');
  const cancelButton = query<HTMLButtonElement>('.cancel');
  const retryButton = query<HTMLButtonElement>('.retry');

  let accounts: Account[] = [];
  let selectedId: AccountId | null = null;
  let snapshot: FlowStateSnapshot | null = null;
  let vaultUnlocked = false;
  let open = false;
  let busy = false;
  let suppressClick = false;
  let dragging: {
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null = null;

  // 球内只放缩写；全名通过 title、aria-label 和展开态面板标题保留
  ballName.textContent = ballAbbreviation(system.name);
  ball.title = `${system.name}（点击展开账号列表）`;
  ball.setAttribute('aria-label', `${system.name}：切换账号`);
  panelTitle.textContent = system.name;
  panelSub.textContent = '仅显示该系统的账号';

  const applyPosition = () => {
    ball.style.left = `${point.x}px`;
    ball.style.top = `${point.y}px`;
  };

  const positionPanel = () => {
    const left = point.x + BALL_SIZE + 12 + PANEL_WIDTH > window.innerWidth - MARGIN
      ? Math.max(MARGIN, point.x - PANEL_WIDTH - 12)
      : point.x + BALL_SIZE + 12;
    const top = Math.max(MARGIN, Math.min(point.y, window.innerHeight - 240));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  const renderNotice = (text: string | null) => {
    notice.hidden = text === null;
    notice.textContent = text ?? '';
  };

  const renderAccounts = () => {
    accountsBox.textContent = '';
    const enabled = accounts.filter((account) => account.enabled);

    if (accounts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '该系统还没有账号，请在扩展设置页添加。';
      accountsBox.append(empty);
      switchButton.disabled = true;
      return;
    }

    for (const account of accounts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account';
      button.setAttribute('role', 'listitem');
      button.setAttribute('aria-pressed', String(account.id === selectedId));
      button.disabled = !account.enabled;

      const label = document.createElement('span');
      label.className = 'account-label';
      label.textContent = account.label || account.username;

      const user = document.createElement('span');
      user.className = 'account-user';
      user.textContent = account.enabled ? account.username : `${account.username}（已停用）`;

      button.append(label, user);
      button.addEventListener('click', () => {
        selectedId = account.id;
        renderAccounts();
        renderSwitch();
      });
      accountsBox.append(button);
    }

    if (!enabled.some((account) => account.id === selectedId)) {
      selectedId = enabled[0]?.id ?? null;
      renderAccounts();
      return;
    }
  };

  const renderSwitch = () => {
    const selected = accounts.find((account) => account.id === selectedId) ?? null;
    if (!selected) {
      switchButton.disabled = true;
      switchButton.textContent = '切换账号';
      return;
    }
    switchButton.disabled = busy;
    switchButton.textContent = busy ? '正在发起…' : `切换到「${selected.label || selected.username}」`;
  };

  const renderFlow = () => {
    if (!snapshot) {
      flowBox.hidden = true;
      return;
    }
    const running = !isTerminalFlowState(snapshot.state);
    flowBox.hidden = false;
    flowState.textContent = FLOW_STATE_LABELS[snapshot.state];
    flowStep.textContent = snapshot.step ? `当前步骤：${FLOW_STEP_LABELS[snapshot.step]}` : '';
    flowError.hidden = snapshot.error === null;
    flowError.textContent = snapshot.error ? errorText(snapshot.error.code) : '';
    const elapsed = Math.max(0, snapshot.updatedAt - snapshot.startedAt);
    flowMeta.textContent = `runId ${snapshot.runId} · 耗时 ${elapsed} ms`;
    cancelButton.hidden = !running;
    retryButton.hidden = snapshot.state !== 'failed';
  };

  const setOpen = (next: boolean) => {
    open = next;
    panel.hidden = !next;
    ball.setAttribute('aria-expanded', String(next));
    if (next) {
      positionPanel();
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('pointerdown', onOutsidePointerDown, true);
      void refresh();
    } else {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    }
  };

  const refresh = async () => {
    try {
      const [allAccounts, vault, state] = await Promise.all([
        callBackground('account.list', {}),
        callBackground('vault.status', {}),
        callBackground('flow.getState', {}),
      ]);
      accounts = allAccounts.filter((account) => account.systemId === system?.id);
      vaultUnlocked = vault.state === 'unlocked';
      snapshot = state;
      renderAccounts();
      renderSwitch();
      renderFlow();
      if (!vaultUnlocked) renderNotice('保险库已锁定：请点击工具栏图标，在弹窗中解锁后再切换。');
      else renderNotice(null);
    } catch (error) {
      renderNotice(describeError(error));
    }
  };

  const startSwitch = async () => {
    const selected = accounts.find((account) => account.id === selectedId) ?? null;
    if (!selected || !system) return;

    busy = true;
    renderSwitch();
    renderNotice(null);
    try {
      const vault = await callBackground('vault.status', {});
      if (vault.state !== 'unlocked') {
        vaultUnlocked = false;
        renderNotice('保险库已锁定：请点击工具栏图标，在弹窗中解锁后再切换。');
        return;
      }
      await callBackground('flow.start', { accountId: selected.id, systemId: system.id });
    } catch (error) {
      renderNotice(describeError(error));
    } finally {
      busy = false;
      renderSwitch();
    }
  };

  /** 叉叉只收起账号列表，回到紧凑态；小球是否显示由 Popup 设置里的开关决定。 */
  const closePanel = () => {
    setOpen(false);
    ball.focus();
  };

  const onOutsidePointerDown = (event: PointerEvent) => {
    if (!open) return;
    // Shadow DOM 内的交互会被重定向到 host，用 composedPath 判断是否点在球或面板上
    if (event.composedPath().includes(host)) return;
    setOpen(false);
  };

  const onResize = () => {
    point = clampBallPoint(point, { width: window.innerWidth, height: window.innerHeight });
    applyPosition();
    if (open) positionPanel();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 面板打开期间才拦截 Esc（对话框语义）；其余按键一律放行，不劫持页面快捷键
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    ball.focus();
  };

  ball.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setOpen(!open);
  });
  ball.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(!open);
    }
  });

  ball.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: point.x,
      originY: point.y,
      moved: false,
    };
    ball.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  ball.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const dx = event.clientX - dragging.startX;
    const dy = event.clientY - dragging.startY;
    if (!dragging.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    dragging.moved = true;
    point = clampBallPoint(
      { x: dragging.originX + dx, y: dragging.originY + dy },
      { width: window.innerWidth, height: window.innerHeight },
    );
    applyPosition();
  });

  const endDrag = async (event: PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const moved = dragging.moved;
    dragging = null;
    if (ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
    if (!moved) return;

    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    // 吸附只在松手时判定，拖动过程中不做任何吸附，避免抖动
    point = snapBallPoint(point, { width: window.innerWidth, height: window.innerHeight });
    applyPosition();
    if (open) positionPanel();
    try {
      await callBackground('ui.saveFloatPosition', { origin, point });
    } catch (error) {
      log.error('float-ball-position-save-failed', error);
    }
  };

  ball.addEventListener('pointerup', (event) => void endDrag(event));
  ball.addEventListener('pointercancel', (event) => void endDrag(event));

  dismissButton.addEventListener('click', () => closePanel());
  switchButton.addEventListener('click', () => void startSwitch());
  cancelButton.addEventListener('click', async () => {
    if (!snapshot?.runId) return;
    try {
      await callBackground('flow.cancel', { runId: snapshot.runId });
    } catch (error) {
      renderNotice(describeError(error));
    }
  });
  retryButton.addEventListener('click', () => void startSwitch());
  panel.addEventListener('click', (event) => event.stopPropagation());

  // Esc 由 setOpen 挂载的 document 捕获监听处理（macOS 点击按钮不聚焦，host 监听收不到）
  window.addEventListener('resize', onResize);

  const disconnect = connectFlowPort({
    onSnapshot: (next) => {
      snapshot = next;
      renderFlow();
    },
    onVaultState: () => {
      void refresh();
    },
    onReconnect: () => {
      void refresh();
    },
  });

  applyPosition();
  document.documentElement.append(host);

  renderAccounts();
  renderSwitch();
  await refresh();

  return {
    unmount: () => {
      host.remove();
      disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    },
  };
}

/**
 * 常驻的悬浮球管理器：负责首次挂载，并监听悬浮球偏好变更。
 * Popup 里的全局开关、站点级隐藏/恢复都写同一组存储键，内容脚本据此即时挂载或移除，
 * 不需要刷新页面。
 */
export function startFloatingBall(): void {
  let handle: FloatBallHandle | null = null;
  let syncing = false;
  let wanted = true;

  const sync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      if (!wanted) {
        handle?.unmount();
        handle = null;
        return;
      }
      if (!handle) handle = await mountFloatingBall();
    } catch (error) {
      log.error('float-ball-mount-failed', error);
    } finally {
      syncing = false;
      if (!wanted && handle) {
        handle.unmount();
        handle = null;
      }
    }
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (FLOAT_STORAGE_KEYS.enabled in changes) {
      wanted = changes[FLOAT_STORAGE_KEYS.enabled]?.newValue !== false;
      void sync();
    }

    const dismissed = changes[FLOAT_STORAGE_KEYS.dismissed];
    if (!dismissed) return;
    const raw = dismissed.newValue;
    const dismissedNow =
      typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)[location.origin] === true;
    wanted = !dismissedNow;
    void sync();
  });

  void sync();
}
