import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlowStatus } from '../../src/popup/components/FlowStatus';
import { OtherSystemsPanel } from '../../src/popup/components/OtherSystemsPanel';
import { SwitchButton } from '../../src/popup/components/SwitchButton';
import { SystemBadge } from '../../src/popup/components/SystemBadge';
import { SystemPicker } from '../../src/popup/components/SystemPicker';
import { UnrecognizedPagePanel } from '../../src/popup/components/UnrecognizedPagePanel';
import { errorText } from '../../src/errors/messages.zh-CN';
import { ERROR_META } from '../../src/shared/types/errors';
import type { ErrorCode, SerializedError } from '../../src/shared/types/errors';
import type { FlowStateSnapshot } from '../../src/shared/types/flow';
import type { AccountId, RunId, SystemId } from '../../src/shared/types/ids';
import type { OASystem, SystemCandidate } from '../../src/shared/types/system';

function failedSnapshot(code: ErrorCode): FlowStateSnapshot {
  const error: SerializedError = {
    code,
    category: ERROR_META[code].category,
    retryable: ERROR_META[code].retryable,
  };
  return {
    runId: 'run_0123456789ab' as RunId,
    state: 'failed',
    accountId: 'acc_0123456789ab' as AccountId,
    systemId: null,
    step: null,
    startedAt: 1,
    updatedAt: 2,
    deadlineAt: null,
    error,
  };
}

const RENDERED_CODES: ErrorCode[] = [
  'E_NOT_IMPLEMENTED',
  'E_INTERRUPTED',
  'E_FLOW_BUSY',
  'E_CONTENT_UNAVAILABLE',
  'E_NO_PERMISSION',
  'E_VALIDATION',
];

describe('SwitchButton', () => {
  it.each(['正在加载配置…', '尚未配置 OA 系统', '保险库未解锁（阶段二接入）'])(
    '禁用原因「%s」时按钮 disabled 且 title 一致',
    (reason) => {
      const html = renderToStaticMarkup(
        <SwitchButton disabledReason={reason} busy={false} onClick={() => undefined} />,
      );
      expect(html).toContain('disabled');
      expect(html).toContain(`title="${reason}"`);
      expect(html).toContain(reason);
    },
  );

  it('无禁用原因时可点击且 title 为开始切换', () => {
    const html = renderToStaticMarkup(
      <SwitchButton disabledReason={null} busy={false} onClick={() => undefined} />,
    );
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain('title="开始切换"');
  });
});

describe('FlowStatus', () => {
  it.each(RENDERED_CODES)('%s 渲染中文文案并附带错误码便于远程排查', (code) => {
    const html = renderToStaticMarkup(<FlowStatus snapshot={failedSnapshot(code)} />);
    expect(html).toContain(errorText(code));
    expect(html).toContain(code);
  });

  it('失败态传入 onRetry 时渲染重试按钮', () => {
    const html = renderToStaticMarkup(
      <FlowStatus snapshot={failedSnapshot('E_NOT_IMPLEMENTED')} onRetry={() => undefined} />,
    );
    expect(html).toContain('重试');
  });

  it('无快照时不渲染', () => {
    expect(renderToStaticMarkup(<FlowStatus snapshot={null} />)).toBe('');
  });
});

describe('SystemBadge', () => {
  it('展示系统名与签名识别依据', () => {
    const html = renderToStaticMarkup(
      <SystemBadge
        name="示例公司 OA（蓝凌）"
        basis={{ kind: 'signature', pattern: 'http://oa.example.com/login.jsp' }}
      />,
    );

    expect(html).toContain('示例公司 OA（蓝凌）');
    expect(html).toContain('识别依据：登录页 / URL 规则');
  });

  it('手动选择时标注来源而不是伪装成自动识别', () => {
    const html = renderToStaticMarkup(<SystemBadge name="OA" basis={null} manual />);
    expect(html).toContain('手动选择（来自其他系统）');
  });
});

describe('UnrecognizedPagePanel', () => {
  const noop = () => undefined;

  it('扩展页提示先切到 OA 标签页，不渲染账号空态', () => {
    const html = renderToStaticMarkup(
      <UnrecognizedPagePanel
        pageKind="extension"
        origin={null}
        onOpenOaTab={noop}
        onShowAllSystems={noop}
      />,
    );

    expect(html).toContain('请先切到 OA 标签页');
    expect(html).toContain('切到 OA 标签页');
    expect(html).not.toContain('还没有账号');
  });

  it('普通网页未识别时给出两个入口', () => {
    const html = renderToStaticMarkup(
      <UnrecognizedPagePanel
        pageKind="web"
        origin="https://other.example.com"
        onOpenOaTab={noop}
        onShowAllSystems={noop}
      />,
    );

    expect(html).toContain('未识别当前页面');
    expect(html).toContain('查看全部系统');
  });
});

describe('SystemPicker', () => {
  const candidates: SystemCandidate[] = [
    { systemId: 'sys_aaaaaaaaaaaa' as SystemId, name: 'A 系统', score: 10, matchedPattern: null },
    { systemId: 'sys_bbbbbbbbbbbb' as SystemId, name: 'B 系统', score: 10, matchedPattern: null },
  ];

  it('渲染候选与记住选项；未选择时确认按钮禁用', () => {
    const html = renderToStaticMarkup(
      <SystemPicker
        candidates={candidates}
        selectedId={null}
        remember
        onSelect={() => undefined}
        onRememberChange={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(html).toContain('多个系统匹配当前页面');
    expect(html).toContain('A 系统');
    expect(html).toContain('B 系统');
    expect(html).toContain('记住本次选择（仅当前路径前缀）');
    expect(html).toMatch(/disabled=""[^>]*>使用所选系统/);
  });
});

describe('OtherSystemsPanel', () => {
  const systems = [
    { id: 'sys_aaaaaaaaaaaa', name: 'A 系统' },
    { id: 'sys_bbbbbbbbbbbb', name: 'B 系统' },
  ] as OASystem[];

  const props = {
    systems,
    activeSystemId: 'sys_aaaaaaaaaaaa' as SystemId,
    selectedId: null,
    accountCounts: { sys_bbbbbbbbbbbb: 2 },
    onToggle: () => undefined,
    onSelectSystem: () => undefined,
  };

  it('折叠时不展示其他系统条目', () => {
    const html = renderToStaticMarkup(<OtherSystemsPanel {...props} open={false} />);
    expect(html).toContain('查看其他系统');
    expect(html).not.toContain('B 系统');
  });

  it('展开后展示其他系统与账号数', () => {
    const html = renderToStaticMarkup(<OtherSystemsPanel {...props} open />);
    expect(html).toContain('B 系统');
    expect(html).toContain('2 个账号');
    expect(html).not.toContain('A 系统');
  });
});
