import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleContentRequest } from '../../src/content/bridge';
import { createRequest } from '../../src/shared/messaging/protocol';
import type { SystemId } from '../../src/shared/types/ids';
import { newRunId } from '../../src/shared/types/ids';

const SYSTEM_ID = 'sys_test' as SystemId;
const CONFIG = { usernameFieldSelector: '#username', passwordFieldSelector: '#password' };

function sender(): chrome.runtime.MessageSender {
  return {} as chrome.runtime.MessageSender;
}

function fillRequest(runId: string, fillMs?: number) {
  return createRequest('oa.fillCredentials', {
    runId: runId as ReturnType<typeof newRunId>,
    systemId: SYSTEM_ID,
    vendor: 'landray',
    adapterConfig: CONFIG,
    ...(fillMs ? { timeouts: { fillMs } } : {}),
    username: 'alice',
    password: 'secret',
  });
}

function cancelRequest(runId: string) {
  return createRequest('oa.cancel', {
    runId: runId as ReturnType<typeof newRunId>,
    systemId: SYSTEM_ID,
    vendor: 'landray',
    adapterConfig: CONFIG,
  });
}

describe('content bridge 取消', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="username" value=""><input id="password" value="">';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('oa.cancel 清空已完成填写留下的字段', async () => {
    const runId = newRunId();
    const fillResponse = await handleContentRequest(fillRequest(runId), sender(), true);
    expect(fillResponse.ok).toBe(true);
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('secret');

    const cancelResponse = await handleContentRequest(cancelRequest(runId), sender(), true);
    expect(cancelResponse).toMatchObject({ ok: true, data: { cancelled: true } });
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it('oa.cancel 中断仍在等待表单的填写命令', async () => {
    const runId = newRunId();
    document.querySelector('#password')?.remove();

    const fillResponse = handleContentRequest(fillRequest(runId, 2_000), sender(), true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cancelResponse = await handleContentRequest(cancelRequest(runId), sender(), true);
    expect(cancelResponse).toMatchObject({ ok: true, data: { cancelled: true } });
    await expect(fillResponse).resolves.toMatchObject({ ok: false });
  });

  it('取消后的同一 runId 不允许再发新命令', async () => {
    const runId = newRunId();
    await handleContentRequest(cancelRequest(runId), sender(), true);

    const response = await handleContentRequest(fillRequest(runId), sender(), true);

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('E_CANCELLED');
  });
});
