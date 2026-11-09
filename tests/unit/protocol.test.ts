import { describe, expect, it } from 'vitest';
import { createRequest, parseRequest } from '../../src/shared/messaging/protocol';
import { TRANSFER_MAX_CONTENT_BYTES } from '../../src/shared/types/transfer';
import type { SystemId } from '../../src/shared/types/ids';

describe('消息信封解析', () => {
  it('C1 合法请求可解析且类型收窄正确', () => {
    const envelope = createRequest('settings.get', {});
    const parsed = parseRequest(envelope);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('合法请求不应被拒绝');
    expect(parsed.value.kind).toBe('req');
    expect(parsed.value.type).toBe('settings.get');
    expect(parsed.value.id).toBe(envelope.id);
  });

  it('C2 缺少 id / type 的请求返回 E_VALIDATION', () => {
    const withoutId = parseRequest({ kind: 'req', type: 'settings.get', payload: {}, createdAt: 1 });
    expect(withoutId.ok).toBe(false);
    if (withoutId.ok) throw new Error('缺少 id 不应通过');
    expect(withoutId.error.code).toBe('E_VALIDATION');
    expect(withoutId.error.detail?.field).toBe('id');

    const withoutType = parseRequest({ kind: 'req', id: 'req_1', payload: {}, createdAt: 1 });
    expect(withoutType.ok).toBe(false);
    if (withoutType.ok) throw new Error('缺少 type 不应通过');
    expect(withoutType.error.code).toBe('E_VALIDATION');
    expect(withoutType.error.detail?.field).toBe('type');
  });

  it('C3 未知 type 被拒绝', () => {
    const parsed = parseRequest({
      kind: 'req',
      id: 'req_1',
      type: 'unknown.type',
      payload: {},
      createdAt: 1,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('未知 type 不应通过');
    expect(parsed.error.code).toBe('E_VALIDATION');
    expect(parsed.error.detail?.reason).toBe('unknown-type');
  });

  it('C4 超过 32KB 的 payload 被拒绝', () => {
    const parsed = parseRequest({
      kind: 'req',
      id: 'req_1',
      type: 'content.ready',
      payload: { url: `https://example.com/${'a'.repeat(40_000)}`, title: 't', frame: 'top' },
      createdAt: 1,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('超长 payload 不应通过');
    expect(parsed.error.code).toBe('E_VALIDATION');
    expect(parsed.error.detail?.reason).toBe('too-large');
  });

  it('C5 悬浮球 ui.* 请求类型在白名单内（回归：unknown-type）', () => {
    for (const type of ['ui.getFloatPrefs', 'ui.dismissFloat', 'ui.saveFloatPosition'] as const) {
      const parsed = parseRequest(createRequest(type, { origin: 'https://oa.example.com' }));
      expect(parsed.ok, `${type} 应可解析`).toBe(true);
    }
  });

  it('C6 自动识别 / 自检请求类型在白名单内（回归：unknown-type）', () => {
    expect(
      parseRequest(createRequest('system.discover', { url: 'http://oa.example.com/login.jsp', vendor: 'landray' })).ok,
    ).toBe(true);
    expect(
      parseRequest(createRequest('system.selfCheck', { systemId: 'sys_test' as SystemId })).ok,
    ).toBe(true);

    const missing = parseRequest({
      kind: 'req',
      id: 'req_1',
      type: 'system.discover',
      payload: { url: 'http://oa.example.com/login.jsp' },
      createdAt: 1,
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('缺少 vendor 不应通过');
    expect(missing.error.detail?.field).toBe('vendor');
  });

  it('必填 payload 字段缺失被拒绝', () => {
    const parsed = parseRequest({
      kind: 'req',
      id: 'req_1',
      type: 'flow.cancel',
      payload: {},
      createdAt: 1,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('缺少 runId 不应通过');
    expect(parsed.error.detail?.field).toBe('runId');
  });

  it('C7 数据迁移请求类型在白名单内，且仅这两条消息放宽到 8MB', () => {
    expect(parseRequest(createRequest('data.export', { mode: 'full' })).ok).toBe(true);
    expect(
      parseRequest(createRequest('data.preview', { content: 'x'.repeat(40_000) })).ok,
    ).toBe(true);
    expect(
      parseRequest(
        createRequest('data.import', {
          content: '{}',
          conflict: 'keep-both',
          vault: 'skip',
        }),
      ).ok,
    ).toBe(true);

    const tooLarge = parseRequest(
      createRequest('data.preview', { content: 'a'.repeat(TRANSFER_MAX_CONTENT_BYTES + 1) }),
    );
    expect(tooLarge.ok).toBe(false);
    if (tooLarge.ok) throw new Error('超过 8MB 的导入内容不应通过');
    expect(tooLarge.error.code).toBe('E_VALIDATION');
    expect(tooLarge.error.detail?.reason).toBe('too-large');
    expect(tooLarge.error.detail?.limit).toBe(TRANSFER_MAX_CONTENT_BYTES);
    expect(typeof tooLarge.error.detail?.elapsedMs).toBe('number');
  });
});
