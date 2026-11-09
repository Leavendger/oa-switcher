import type { AccountId, RunId, SystemId } from './ids';
import type { SerializedError } from './errors';
import type { VaultState } from './settings';

export type FlowState =
  | 'idle'
  | 'resolving'
  | 'probing'
  | 'loggingOut'
  | 'awaitingLogin'
  | 'filling'
  | 'submitting'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const FLOW_TERMINAL_STATES: readonly FlowState[] = ['completed', 'failed', 'cancelled'];

export function isTerminalFlowState(state: FlowState): boolean {
  return FLOW_TERMINAL_STATES.includes(state);
}

export type FlowStepName = 'resolve' | 'probe' | 'logout' | 'waitLoginPage' | 'fill' | 'submit' | 'verify';

/** 状态/步骤文案：Popup 与页面内悬浮球共用，避免两处措辞漂移。 */
export const FLOW_STATE_LABELS: Record<FlowState, string> = {
  idle: '待机',
  resolving: '校验账号与系统配置',
  probing: '检测当前登录状态',
  loggingOut: '退出当前账号',
  awaitingLogin: '等待登录页就绪',
  filling: '填写目标账号密码',
  submitting: '提交登录',
  verifying: '验证登录结果',
  completed: '切换成功',
  failed: '切换失败',
  cancelled: '已取消',
};

export const FLOW_STEP_LABELS: Record<FlowStepName, string> = {
  resolve: '校验配置',
  probe: '检测登录状态',
  logout: '退出登录',
  waitLoginPage: '等待登录页',
  fill: '填写账号密码',
  submit: '提交登录',
  verify: '验证登录结果',
};

export type FlowEvent =
  | 'START'
  | 'RESOLVED'
  | 'STATE_LOGGED_OUT'
  | 'STATE_LOGGED_IN'
  | 'STATE_UNKNOWN'
  | 'BLOCKED_CAPTCHA'
  | 'BLOCKED_MFA'
  | 'LOGGED_OUT'
  | 'PAGE_READY'
  | 'FILLED'
  | 'SUBMITTED'
  | 'VERIFIED_SUCCESS'
  | 'VERIFIED_FAILURE'
  | 'DEADLINE'
  | 'CANCEL'
  | 'TIMEOUT'
  | 'ERROR';

export interface FlowStateSnapshot {
  runId: RunId;
  state: FlowState;
  accountId: AccountId;
  systemId: SystemId | null;
  step: FlowStepName | null;
  startedAt: number;
  updatedAt: number;
  deadlineAt: number | null;
  error: SerializedError | null;
}

export interface FlowStateEvent {
  kind: 'evt';
  type: 'flow.state';
  runId: RunId;
  snapshot: FlowStateSnapshot;
}

/** 保险库状态广播：UI 收到后应重新向后台拉取权威状态，而不是沿用本地旧值。 */
export interface VaultStateEvent {
  kind: 'evt';
  type: 'vault.state';
  state: VaultState;
}

export type FrameRole = 'top' | 'sub';

export interface ContentPingData {
  url: string;
  title: string;
  ready: true;
  frame: FrameRole;
  adapterVersion: string;
}
