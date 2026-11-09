import type { SystemId } from './ids';

export type OaVendor = 'landray' | 'other';

/** 各 vendor 的适配配置。v1 阶段对 Background 与 Storage 完全不透明。 */
export type AdapterConfig = Record<string, unknown>;

export type PermissionState = 'unknown' | 'granted' | 'denied';

export interface AdapterTimeouts {
  stateProbeMs: number;
  logoutTriggerMs: number;
  logoutConfirmMs: number;
  loginPageWaitMs: number;
  fillMs: number;
  submitMs: number;
  verifyMs: number;
  pollMs: number;
}

export const DEFAULT_ADAPTER_TIMEOUTS: AdapterTimeouts = {
  stateProbeMs: 5_000,
  logoutTriggerMs: 5_000,
  logoutConfirmMs: 15_000,
  loginPageWaitMs: 15_000,
  fillMs: 3_000,
  submitMs: 5_000,
  verifyMs: 20_000,
  pollMs: 300,
};

export interface OASystem {
  id: SystemId;
  name: string;
  vendor: OaVendor;
  enabled: boolean;
  /** 形如 https://oa.example.com（仅协议 + 主机 + 端口，不含路径） */
  origins: string[];
  /**
   * URL 签名：用于同域多系统的路径级区分。
   * 支持完整 URL、glob（* / ?）与 `re:` 正则；为空时回退到 loginUrl / homeUrl。
   */
  urlSignatures: string[];
  loginUrl: string;
  homeUrl: string | null;
  adapterConfig: AdapterConfig;
  permissionState: PermissionState;
  /** 按 origin 记录的真实授权结果；系统级 permissionState 由其派生。 */
  originPermissions: Record<string, PermissionState>;
  createdAt: number;
  updatedAt: number;
}

export interface OASystemDraft {
  name: string;
  vendor: OaVendor;
  enabled: boolean;
  origins: string[];
  urlSignatures?: string[];
  loginUrl: string;
  homeUrl: string | null;
  adapterConfig: AdapterConfig;
}

/** 活动标签页类型：只有 web 页面才可能属于某个 OA 系统。 */
export type PageKind = 'web' | 'extension' | 'newtab' | 'browser' | 'unknown';

/** 系统识别依据：签名规则 > origin；remembered 表示沿用用户上次在同类路径上的选择。 */
export interface ResolveBasis {
  kind: 'signature' | 'origin' | 'remembered';
  pattern?: string;
}

export interface SystemCandidate {
  systemId: SystemId;
  name: string;
  /** 最高命中签名的具体度；未命中任何签名为 -1。 */
  score: number;
  matchedPattern: string | null;
}

/** Background 对「当前活动标签页属于哪个系统」的统一结论。 */
export interface ActiveTabResolution {
  tabId: number | null;
  url: string | null;
  pageKind: PageKind;
  origin: string | null;
  status: 'matched' | 'ambiguous' | 'none';
  systemId: SystemId | null;
  basis: ResolveBasis | null;
  /** 命中或并列候选，供 Popup 渲染选择器。 */
  candidates: SystemCandidate[];
  /** 同一 origin 下所有启用系统，供切换前归属校验。 */
  originSystems: SystemCandidate[];
  /** 「记住本次选择」作用域键（origin + 目录前缀）。 */
  rememberKey: string | null;
}
