import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, sanitizeRecord } from '../../src/shared/log';
import { FlowError } from '../../src/shared/types/errors';

describe('日志脱敏', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('敏感键被打码，URL 裁剪到 origin', () => {
    const result = sanitizeRecord({
      password: 'secret-value',
      url: 'https://oa.example.com/path?sessionid=abc',
      nested: { token: 'tok', note: 'ok' },
    });

    expect(result.password).toBe('[redacted]');
    expect(result.url).toBe('https://oa.example.com');
    expect(result.nested).toEqual({ token: '[redacted]', note: 'ok' });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('sessionid');
    expect(JSON.stringify(result.nested)).not.toContain('"tok"');
  });

  it('主密码字段同样被打码', () => {
    const result = sanitizeRecord({
      masterPassword: 'master-secret',
      password: 'account-secret',
      cookie: 'session=abc',
      token: 'tok',
    });

    expect(result.masterPassword).toBe('[redacted]');
    expect(result.password).toBe('[redacted]');
    expect(result.cookie).toBe('[redacted]');
    expect(result.token).toBe('[redacted]');
    expect(JSON.stringify(result)).not.toContain('master-secret');
    expect(JSON.stringify(result)).not.toContain('account-secret');
  });

  it('error 日志只输出错误码，不输出 message 与 detail', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log.error('login-failed', new FlowError('E_LOGIN_REJECTED', { password: 'p' }));

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload.code).toBe('E_LOGIN_REJECTED');
    expect(JSON.stringify(payload)).not.toContain('"p"');
  });
});
