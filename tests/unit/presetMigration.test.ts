import { describe, expect, it } from 'vitest';
import {
  LANDRAY_PRESET_ID,
  LANDRAY_PRESET_VERSION,
} from '../../src/adapters/landray/preset';
import { migrateLegacyLandrayPreset } from '../../src/background/services/presetMigration';
import type { OASystem } from '../../src/shared/types/system';

const ORIGIN = 'http://oa.example.com';

function makeSystem(overrides: Partial<OASystem> = {}): OASystem {
  return {
    id: 'sys_1' as OASystem['id'],
    name: 'OA',
    vendor: 'landray',
    enabled: true,
    origins: [ORIGIN],
    urlSignatures: [`${ORIGIN}/sys/portal/*`],
    loginUrl: `${ORIGIN}/login.jsp`,
    homeUrl: null,
    adapterConfig: {
      schemaVersion: 1,
      preset: { id: LANDRAY_PRESET_ID, version: '2026-11-09' },
      authenticatedUrlPattern: `${ORIGIN}/sys/portal/page.jsp*`,
      notes: '蓝凌预设 v2026-11-09（两环境交叉校验，可逐项覆盖）',
    },
    permissionState: 'granted',
    originPermissions: { [ORIGIN]: 'granted' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('旧蓝凌预设迁移', () => {
  it('把门户页精确规则改成 /sys/*，并同步 URL 签名与预设版本', () => {
    const migrated = migrateLegacyLandrayPreset(makeSystem());

    expect(migrated).not.toBeNull();
    expect(migrated?.adapterConfig.authenticatedUrlPattern).toBe(`${ORIGIN}/sys/*`);
    expect(migrated?.urlSignatures).toEqual([`${ORIGIN}/sys/*`]);
    expect(migrated?.adapterConfig.preset).toEqual({
      id: LANDRAY_PRESET_ID,
      version: LANDRAY_PRESET_VERSION,
    });
    expect(migrated?.adapterConfig.notes).toContain(LANDRAY_PRESET_VERSION);
  });

  it('用户手改过的规则不迁移', () => {
    const system = makeSystem({
      adapterConfig: {
        preset: { id: LANDRAY_PRESET_ID, version: '2026-11-09' },
        authenticatedUrlPattern: `${ORIGIN}/home*`,
      },
    });
    expect(migrateLegacyLandrayPreset(system)).toBeNull();
  });

  it('非预设来源或已迁移过的配置保持原样', () => {
    const manual = makeSystem({
      adapterConfig: { authenticatedUrlPattern: `${ORIGIN}/sys/portal/page.jsp*` },
    });
    const current = makeSystem({
      adapterConfig: {
        preset: { id: LANDRAY_PRESET_ID, version: LANDRAY_PRESET_VERSION },
        authenticatedUrlPattern: `${ORIGIN}/sys/*`,
      },
    });
    expect(migrateLegacyLandrayPreset(manual)).toBeNull();
    expect(migrateLegacyLandrayPreset(current)).toBeNull();
  });
});
