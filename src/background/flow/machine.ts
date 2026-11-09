import { FlowError } from '../../shared/types/errors';
import { isTerminalFlowState, type FlowEvent, type FlowState } from '../../shared/types/flow';

/** 领域事件迁移表。CANCEL / TIMEOUT / ERROR 由 nextState 统一处理。 */
export const FLOW_TRANSITIONS: Record<FlowState, Partial<Record<FlowEvent, FlowState>>> = {
  idle: { START: 'resolving' },
  resolving: { RESOLVED: 'probing' },
  probing: {
    STATE_LOGGED_IN: 'loggingOut',
    STATE_LOGGED_OUT: 'awaitingLogin',
    STATE_UNKNOWN: 'failed',
    BLOCKED_CAPTCHA: 'failed',
    BLOCKED_MFA: 'failed',
  },
  loggingOut: { LOGGED_OUT: 'awaitingLogin' },
  awaitingLogin: { PAGE_READY: 'filling' },
  filling: { FILLED: 'submitting' },
  submitting: { SUBMITTED: 'verifying' },
  verifying: {
    VERIFIED_SUCCESS: 'completed',
    VERIFIED_FAILURE: 'failed',
    DEADLINE: 'failed',
  },
  completed: {},
  failed: {},
  cancelled: {},
};

export function nextState(current: FlowState, event: FlowEvent): FlowState | null {
  if (isTerminalFlowState(current)) return null;
  if (event === 'CANCEL') return 'cancelled';
  if (event === 'TIMEOUT' || event === 'ERROR') return 'failed';
  return FLOW_TRANSITIONS[current][event] ?? null;
}

export function canTransition(current: FlowState, event: FlowEvent): boolean {
  return nextState(current, event) !== null;
}

export function assertTransition(current: FlowState, event: FlowEvent): FlowState {
  const next = nextState(current, event);
  if (!next) {
    throw new FlowError('E_INTERNAL', {
      reason: 'invalid-transition',
      step: `${current}->${event}`,
      stage: 'machine',
    });
  }
  return next;
}
