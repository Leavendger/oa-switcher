// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, describeError, errorText } from '../../src/errors/messages.zh-CN';
import { ERROR_CODES, FlowError } from '../../src/shared/types/errors';

describe('错误码中文映射', () => {
  it('每个错误码都有非空且不同于错误码本身的中文提示', () => {
    for (const code of ERROR_CODES) {
      const text = ERROR_MESSAGES[code];
      expect(text, code).toBeTruthy();
      expect(text, code).not.toBe(code);
    }
  });

  it('未知错误与 FlowError 都有可读提示', () => {
    expect(errorText(undefined)).toBe('未知错误');
    expect(errorText('E_TIMEOUT')).toBe(ERROR_MESSAGES.E_TIMEOUT);
    expect(describeError(new FlowError('E_CONTENT_UNAVAILABLE'))).toContain('无法与 OA 页面通信');
    expect(describeError(new Error('raw message')).startsWith('未知错误')).toBe(true);
  });

  it('不会把原始异常 message 直接展示给用户', () => {
    expect(describeError(new Error('password=secret'))).not.toContain('password');
  });
});
