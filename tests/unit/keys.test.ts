import { describe, expect, it } from 'vitest';
import { SESSION_KEYS, STORAGE_KEYS, STORAGE_PREFIX } from '../../src/storage/keys';

describe('storage key 规划', () => {
  const localKeys = Object.values(STORAGE_KEYS);
  const sessionKeys = Object.values(SESSION_KEYS);

  it('所有 key 都以 oa.v1. 开头', () => {
    expect(STORAGE_PREFIX).toBe('oa.v1.');
    for (const key of [...localKeys, ...sessionKeys]) {
      expect(key.startsWith(STORAGE_PREFIX)).toBe(true);
    }
  });

  it('所有 key 唯一且命名规范（无大写/空格）', () => {
    const all = [...localKeys, ...sessionKeys];
    expect(new Set(all).size).toBe(all.length);
    for (const key of all) {
      expect(key).not.toMatch(/[A-Z\s]/);
    }
  });

  it('阶段一冻结的 key 集合齐全', () => {
    const expected = [
      'meta',
      'settings',
      'systems',
      'groups',
      'accounts',
      'vault',
      'audit',
      'float.enabled',
      'float.dismissed',
      'float.positions',
    ]
      .map((name) => `${STORAGE_PREFIX}${name}`)
      .sort();
    expect(localKeys.sort()).toEqual(expected);
    expect(SESSION_KEYS.run).toBe('oa.v1.session.run');
  });
});
