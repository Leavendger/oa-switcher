import type { OASystem } from '../../shared/types/system';
import { LANDRAY_PRESET_ID, LANDRAY_PRESET_VERSION } from '../../shared/constants';

/** 0.1.0 发布的预设版本与它写死的「登录成功」路径。 */
const LEGACY_PRESET_VERSION = '2026-11-09';
const LEGACY_AUTH_PATTERN_SUFFIX = '/sys/portal/page.jsp*';
const LEGACY_SIGNATURE_SUFFIX = '/sys/portal/*';
const LEGACY_NOTES = '蓝凌预设 v2026-11-09（两环境交叉校验，可逐项覆盖）';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把旧预设（只认门户页 `/sys/portal/page.jsp*`）迁移到 `/sys/*`。
 * 只处理「预设来源标记仍是旧版本、且值恰好等于旧模板」的系统：
 * 用户手改过的配置一律不动，避免静默覆盖。
 */
export function migrateLegacyLandrayPreset(system: OASystem): OASystem | null {
  if (system.vendor !== 'landray') return null;
  const config = system.adapterConfig;
  if (!isRecord(config)) return null;

  const preset = config.preset;
  if (!isRecord(preset) || preset.id !== LANDRAY_PRESET_ID) return null;
  if (preset.version !== LEGACY_PRESET_VERSION) return null;

  const origin = system.origins.find(
    (item) => config.authenticatedUrlPattern === `${item}${LEGACY_AUTH_PATTERN_SUFFIX}`,
  );
  if (!origin) return null;

  return {
    ...system,
    adapterConfig: {
      ...config,
      authenticatedUrlPattern: `${origin}/sys/*`,
      preset: { id: LANDRAY_PRESET_ID, version: LANDRAY_PRESET_VERSION },
      ...(config.notes === LEGACY_NOTES
        ? { notes: `蓝凌预设 v${LANDRAY_PRESET_VERSION}（两环境交叉校验，可逐项覆盖）` }
        : {}),
    },
    urlSignatures: system.urlSignatures.map((signature) =>
      signature === `${origin}${LEGACY_SIGNATURE_SUFFIX}` ? `${origin}/sys/*` : signature,
    ),
    updatedAt: Date.now(),
  };
}
