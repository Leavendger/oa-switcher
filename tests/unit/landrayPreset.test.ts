import { describe, expect, it } from 'vitest';
import {
  buildLandrayPresetConfig,
  buildLandrayPresetDraft,
  LANDRAY_PRESET_FIELDS,
  LANDRAY_PRESET_ID,
  LANDRAY_PRESET_TEMPLATE,
  LANDRAY_PRESET_VERSION,
  PRESET_ORIGIN_PLACEHOLDER,
} from '../../src/adapters/landray/preset';
import { LANDRAY_REQUIRED_KEYS } from '../../src/adapters/landray/config';
import { matchesUrlPattern } from '../../src/shared/urlMatch';

const ORIGIN = 'http://oa.example.com';

describe('蓝凌厂商预设', () => {
  it('展开后覆盖 landray 全部必需键位（含退出入口与二次确认）', () => {
    const { config } = buildLandrayPresetConfig(ORIGIN);

    for (const key of LANDRAY_REQUIRED_KEYS) {
      expect(config[key], `缺少必需键 ${key}`).toBeTruthy();
    }
    expect(config.submitTrigger).toEqual({ kind: 'click', selector: 'input[name="btn_submit"]' });
    expect(config.logoutTrigger).toEqual({
      kind: 'click',
      selector: 'div.lui_single_menu_header_logout .lui_dropdown_toggle',
      confirmSelector: 'div.lui_dialog_main .lui_widget_btn.lui_toolbar_btn_def',
    });
  });

  it('URL 规则全部以 {origin} 占位，展开后不残留占位符且不含其它域名', () => {
    const { config, urlSignatures } = buildLandrayPresetConfig(ORIGIN);

    const urlValues = [
      config.loginPageUrlPattern,
      config.authenticatedUrlPattern,
      config.loggedOutUrlPattern,
      ...urlSignatures,
    ].filter((value): value is string => typeof value === 'string');

    expect(urlValues.length).toBeGreaterThan(0);
    for (const value of urlValues) {
      expect(value.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(value).not.toContain(PRESET_ORIGIN_PLACEHOLDER);
      expect(value).not.toMatch(/58\.210\.53\.246|180\.97\.153\.224/);
    }
  });

  it('模板本身不包含任何具体域名、IP 或 http(s) 地址', () => {
    for (const [key, value] of Object.entries(LANDRAY_PRESET_TEMPLATE)) {
      expect(value, `${key} 不应包含 http(s) 地址`).not.toMatch(/https?:\/\//i);
      expect(value, `${key} 不应包含 IPv4 地址`).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      expect(value, `${key} 不应包含 localhost`).not.toMatch(/localhost/i);
    }
  });

  it('草稿字段与声明字段一致，且空值字段（退出地址）不进入草稿', () => {
    const draft = buildLandrayPresetDraft(ORIGIN);

    for (const key of LANDRAY_PRESET_FIELDS) {
      if (LANDRAY_PRESET_TEMPLATE[key].length === 0) {
        expect(draft[key]).toBeUndefined();
      } else {
        expect(draft[key]?.length).toBeGreaterThan(0);
      }
    }
    expect(draft.logoutUrl).toBeUndefined();
  });

  it('配置携带预设来源标记，供自检判断是否可能过期', () => {
    const { config } = buildLandrayPresetConfig(ORIGIN);

    expect(config.preset).toEqual({ id: LANDRAY_PRESET_ID, version: LANDRAY_PRESET_VERSION });
    expect(config.notes).toContain(LANDRAY_PRESET_VERSION);
  });

  it('URL 签名基于 {origin} 的站点路径，而不是完整登录地址', () => {
    const { urlSignatures } = buildLandrayPresetConfig(ORIGIN);

    expect(urlSignatures).toEqual([`${ORIGIN}/sys/*`]);
  });

  it('登录成功规则覆盖门户之外的 /sys/ 页面，且不会命中登录页', () => {
    const { config } = buildLandrayPresetConfig(ORIGIN);
    const pattern = config.authenticatedUrlPattern;

    expect(pattern).toBe(`${ORIGIN}/sys/*`);
    expect(matchesUrlPattern(pattern, `${ORIGIN}/sys/portal/page.jsp`)).toBe(true);
    expect(
      matchesUrlPattern(pattern, `${ORIGIN}/sys/profile/index.jsp#system/systemview`),
    ).toBe(true);
    expect(matchesUrlPattern(pattern, `${ORIGIN}/login.jsp`)).toBe(false);
    expect(matchesUrlPattern(pattern, `${ORIGIN}/login.jsp;jsessionid=abc`)).toBe(false);
  });
});
