import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  FLOW_TRANSITIONS,
  nextState,
} from '../../src/background/flow/machine';
import type { FlowEvent, FlowState } from '../../src/shared/types/flow';

const ALL_STATES: FlowState[] = [
  'idle',
  'resolving',
  'probing',
  'loggingOut',
  'awaitingLogin',
  'filling',
  'submitting',
  'verifying',
  'completed',
  'failed',
  'cancelled',
];

describe('流程状态机', () => {
  const legalCases = (
    Object.entries(FLOW_TRANSITIONS) as [FlowState, Partial<Record<FlowEvent, FlowState>>][]
  ).flatMap(([from, events]) =>
    (Object.entries(events) as [FlowEvent, FlowState][]).map(([event, to]) => ({
      from,
      event,
      to,
    })),
  );

  it.each(legalCases)('$from --$event--> $to 是合法迁移', ({ from, event, to }) => {
    expect(nextState(from, event)).toBe(to);
    expect(canTransition(from, event)).toBe(true);
    expect(assertTransition(from, event)).toBe(to);
  });

  it.each([
    ['idle', 'RESOLVED'],
    ['idle', 'FILLED'],
    ['resolving', 'START'],
    ['completed', 'START'],
    ['failed', 'CANCEL'],
  ] as [FlowState, FlowEvent][])('%s --%s--> 非法迁移抛 E_INTERNAL', (from, event) => {
    expect(canTransition(from, event)).toBe(false);
    expect(() => assertTransition(from, event)).toThrowError('E_INTERNAL');
  });

  it('非法迁移的错误详情标记 invalid-transition 且不改变入参状态', () => {
    const from: FlowState = 'idle';
    try {
      assertTransition(from, 'SUBMITTED');
      throw new Error('应当抛出错误');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'E_INTERNAL',
        detail: { reason: 'invalid-transition', step: 'idle->SUBMITTED' },
      });
    }
    expect(from).toBe('idle');
  });

  it.each(ALL_STATES.filter((state) => state !== 'completed' && state !== 'failed' && state !== 'cancelled'))(
    '任意非终态 %s 收到 CANCEL 都进入 cancelled',
    (state) => {
      expect(nextState(state, 'CANCEL')).toBe('cancelled');
    },
  );

  it('终态不再接受任何事件', () => {
    for (const terminal of ['completed', 'failed', 'cancelled'] as FlowState[]) {
      expect(nextState(terminal, 'CANCEL')).toBeNull();
      expect(nextState(terminal, 'START')).toBeNull();
    }
  });
});
