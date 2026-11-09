import { beforeEach, describe, expect, it } from 'vitest';
import { createPageDriver } from '../../src/content/pageDriver';

describe('PageDriver（jsdom）', () => {
  const driver = createPageDriver();

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('setValue 触发 input 与 change 事件', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    input.addEventListener('blur', () => events.push('blur'));

    await driver.setValue(input, 'alice');
    expect(input.value).toBe('alice');
    expect(events).toEqual(['input', 'change', 'blur']);
  });

  it('setValue 对非输入元素报 E_FILL_FAILED', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    await expect(driver.setValue(div, 'x')).rejects.toMatchObject({ code: 'E_FILL_FAILED' });
  });

  it('waitFor 超时抛出指定错误码', async () => {
    const controller = new AbortController();
    await expect(
      driver.waitFor('#missing', {
        timeoutMs: 0,
        signal: controller.signal,
        timeoutCode: 'E_LOGIN_PAGE_TIMEOUT',
      }),
    ).rejects.toMatchObject({ code: 'E_LOGIN_PAGE_TIMEOUT' });
  });

  it('waitFor 命中已存在元素', async () => {
    document.body.innerHTML = '<div id="hit"></div>';
    const controller = new AbortController();
    const element = await driver.waitFor('#hit', { timeoutMs: 10, signal: controller.signal });
    expect(element.id).toBe('hit');
  });

  it('已中止的 signal 立即抛 E_CANCELLED', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      driver.waitFor('#any', { timeoutMs: 100, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'E_CANCELLED' });
  });

  it('非法 CSS 选择器映射为 E_CONFIG_MISSING 而不是内部错误', async () => {
    const controller = new AbortController();
    expect(() => driver.query('[invalid')).toThrowError(
      expect.objectContaining({ code: 'E_CONFIG_MISSING' }),
    );
    await expect(
      driver.waitFor('[invalid', { timeoutMs: 10, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'E_CONFIG_MISSING' });
  });
});
