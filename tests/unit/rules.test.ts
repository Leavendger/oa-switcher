import { describe, expect, it } from 'vitest';
import { matchesUrlPattern, selectVerificationOutcome } from '../../src/adapters/landray/rules';

describe('URL 规则匹配', () => {
  it('完整 URL 精确命中', () => {
    expect(matchesUrlPattern('https://oa.example.com/login', 'https://oa.example.com/login')).toBe(
      true,
    );
    expect(
      matchesUrlPattern('https://oa.example.com/login', 'https://oa.example.com/login2'),
    ).toBe(false);
  });

  it('无 glob 时允许 query / hash 后缀', () => {
    const pattern = 'https://oa.example.com/login';
    expect(matchesUrlPattern(pattern, 'https://oa.example.com/login?next=/home')).toBe(true);
    expect(matchesUrlPattern(pattern, 'https://oa.example.com/login#top')).toBe(true);
  });

  it('glob 的 * 与 ? 生效', () => {
    expect(
      matchesUrlPattern(
        'https://oa.example.com/*/login*',
        'https://oa.example.com/portal/login?foo=1',
      ),
    ).toBe(true);
    expect(matchesUrlPattern('https://oa.example.com/u?er', 'https://oa.example.com/user')).toBe(
      true,
    );
    expect(matchesUrlPattern('https://oa.example.com/u?er', 'https://oa.example.com/useer')).toBe(
      false,
    );
  });

  it('re: 前缀按正则处理', () => {
    expect(
      matchesUrlPattern('re:^https://oa\\.example\\.com/(portal|home)', 'https://oa.example.com/home'),
    ).toBe(true);
    expect(
      matchesUrlPattern('re:^https://oa\\.example\\.com/(portal|home)', 'https://oa.example.com/login'),
    ).toBe(false);
  });

  it('非法正则返回 false 而不是抛出', () => {
    expect(matchesUrlPattern('re:[', 'https://oa.example.com/')).toBe(false);
  });

  it('空串、空白、undefined 一律不匹配', () => {
    expect(matchesUrlPattern('', 'https://oa.example.com/')).toBe(false);
    expect(matchesUrlPattern('   ', 'https://oa.example.com/')).toBe(false);
    expect(matchesUrlPattern(undefined, 'https://oa.example.com/')).toBe(false);
    expect(matchesUrlPattern(null, 'https://oa.example.com/')).toBe(false);
  });

  it('无关 URL 不命中', () => {
    expect(matchesUrlPattern('https://oa.example.com/login', 'https://other.example.com/login')).toBe(
      false,
    );
  });
});

describe('验证结果优先级', () => {
  it('失败证据压过成功证据', () => {
    expect(selectVerificationOutcome(['failure', 'success'])).toBe('failure');
    expect(selectVerificationOutcome(['success', 'failure'])).toBe('failure');
  });

  it('只有成功证据时返回 success', () => {
    expect(selectVerificationOutcome(['success'])).toBe('success');
  });

  it('只有失败证据时返回 failure', () => {
    expect(selectVerificationOutcome(['failure'])).toBe('failure');
  });

  it('无有效证据返回 unknown', () => {
    expect(selectVerificationOutcome([])).toBe('unknown');
    expect(selectVerificationOutcome([null])).toBe('unknown');
  });
});
