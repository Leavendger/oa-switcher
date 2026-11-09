import { useState } from 'react';
import {
  buildLandrayPresetDraft,
  LANDRAY_PRESET_EVIDENCE,
  LANDRAY_PRESET_ID,
  LANDRAY_PRESET_VERSION,
} from '../../adapters/landray/preset';
import { describeError } from '../../errors/messages.zh-CN';
import { log } from '../../shared/log';
import { callBackground } from '../../shared/messaging/client';
import { FlowError } from '../../shared/types/errors';
import type {
  DiscoveryField,
  DiscoveryFieldKey,
  DiscoveryResult,
  DiscoveryStatus,
  SelfCheckResult,
  SelfCheckState,
} from '../../shared/types/discovery';
import { DISCOVERY_FIELD_LABELS, DISCOVERY_FIELD_ORDER } from '../../shared/types/discovery';
import type { SystemId } from '../../shared/types/ids';
import type { OASystem, OaVendor } from '../../shared/types/system';
import { Button } from '../../ui/Button';
import { Field, inputClass } from '../../ui/Field';
import { Modal } from '../../ui/Modal';

interface SystemsSectionProps {
  systems: OASystem[];
  activeSystemId: SystemId | null;
  reload: () => Promise<void>;
}

const EMPTY_FORM = {
  name: '',
  url: '',
  vendor: 'other' as OaVendor,
};

const DISCOVERY_STATUS_LABELS: Record<DiscoveryStatus, string> = {
  auto: '自动识别',
  'needs-confirmation': '需人工确认',
  unknown: '无法识别',
};

const DISCOVERY_STATUS_CLASSES: Record<DiscoveryStatus, string> = {
  auto: 'text-success',
  'needs-confirmation': 'text-accent',
  unknown: 'text-danger',
};

const SELF_CHECK_STATE_LABELS: Record<SelfCheckState, string> = {
  loggedIn: '已登录',
  loggedOut: '未登录',
  unknown: '无法判断',
};

const SELF_CHECK_STATE_CLASSES: Record<SelfCheckState, string> = {
  loggedIn: 'text-success',
  loggedOut: 'text-accent',
  unknown: 'text-danger',
};

const SELECT_OPTIONS: Partial<Record<DiscoveryFieldKey, Array<{ value: string; label: string }>>> = {
  submitKind: [
    { value: '', label: '未确认' },
    { value: 'click', label: 'click（点击提交元素）' },
    { value: 'formSubmit', label: 'formSubmit（表单提交）' },
  ],
  logoutKind: [
    { value: '', label: '未确认' },
    { value: 'click', label: 'click（点击退出入口）' },
    { value: 'url', label: 'url（访问退出地址）' },
  ],
};

const CONFIG_TEXT_KEYS = [
  'loginPageUrlPattern',
  'loginFormReadySelector',
  'usernameFieldSelector',
  'passwordFieldSelector',
  'loggedInMarkerSelector',
  'loggedOutMarkerSelector',
  'authenticatedUrlPattern',
  'loginFailureMarkerSelector',
  'loggedOutUrlPattern',
] as const;

type DraftValues = Partial<Record<DiscoveryFieldKey, string>>;

function splitLines(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** URL 规则去掉末尾通配后若能构成合法 URL，用作首页地址；否则留空。 */
function deriveHomeUrl(pattern: string | undefined): string | null {
  const trimmed = (pattern ?? '').trim().replace(/\*+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

/** 只写入用户确认过的非空字段；空值一律不落盘，避免「猜一个」的选择器进入配置。 */
function buildAdapterConfig(values: DraftValues, fromPreset: boolean): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (fromPreset) config.preset = { id: LANDRAY_PRESET_ID, version: LANDRAY_PRESET_VERSION };
  for (const key of CONFIG_TEXT_KEYS) setOrDelete(config, key, values[key] ?? '');

  const submitKind = values.submitKind === 'formSubmit' ? 'formSubmit' : values.submitKind === 'click' ? 'click' : '';
  const submitSelector = (values.submitSelector ?? '').trim();
  if (submitKind && submitSelector) {
    config.submitTrigger = { kind: submitKind, selector: submitSelector };
  } else {
    delete config.submitTrigger;
  }

  const logoutKind = values.logoutKind === 'url' ? 'url' : values.logoutKind === 'click' ? 'click' : '';
  const logoutUrl = (values.logoutUrl ?? '').trim();
  const logoutSelector = (values.logoutSelector ?? '').trim();
  const logoutConfirm = (values.logoutConfirmSelector ?? '').trim();
  if (logoutKind === 'url' && logoutUrl) {
    config.logoutTrigger = { kind: 'url', url: logoutUrl };
  } else if (logoutKind === 'click' && logoutSelector) {
    config.logoutTrigger = {
      kind: 'click',
      selector: logoutSelector,
      ...(logoutConfirm ? { confirmSelector: logoutConfirm } : {}),
    };
  } else {
    delete config.logoutTrigger;
  }

  return config;
}

/**
 * 用厂商预设生成「识别结果」草稿：每个字段都标为自动识别并附交叉校验依据，
 * 用户仍可逐项覆盖；空值字段标为无法识别，不伪装成功。
 */
function buildPresetDiscovery(url: string, origin: string): { result: DiscoveryResult; values: DraftValues } {
  const draft = buildLandrayPresetDraft(origin);
  const fields: DiscoveryField[] = DISCOVERY_FIELD_ORDER.map((key) => {
    const value = (draft[key] ?? '').trim();
    const evidenceText = LANDRAY_PRESET_EVIDENCE[key];
    return {
      key,
      label: DISCOVERY_FIELD_LABELS[key],
      value,
      status: value.length > 0 ? 'auto' : 'unknown',
      evidence:
        value.length > 0
          ? [{ label: '预设依据', detail: evidenceText ?? `蓝凌预设 v${LANDRAY_PRESET_VERSION}` }]
          : [{ label: '说明', detail: '预设不提供该字段，需人工确认' }],
    } satisfies DiscoveryField;
  });

  return {
    result: {
      requestedUrl: url,
      finalUrl: url,
      title: '',
      vendor: 'landray',
      fields,
      notes: [
        `已按蓝凌预设 v${LANDRAY_PRESET_VERSION} 填充（两环境交叉校验：登录页 + 登录后 + 退出确认）。`,
        '预设值可以逐项覆盖；保存后可点「自检」验证选择器在该站点的命中数量。',
      ],
    },
    values: draft,
  };
}


const PERMISSION_LABELS = {
  unknown: '未检测',
  granted: '已授权',
  denied: '未授权',
} as const;

interface SystemEditorState {
  id: SystemId;
  name: string;
  enabled: boolean;
  origins: string;
  urlSignatures: string;
  loginUrl: string;
  homeUrl: string;
  loginPageUrlPattern: string;
  loginFormReadySelector: string;
  usernameFieldSelector: string;
  passwordFieldSelector: string;
  submitKind: 'formSubmit' | 'click';
  submitSelector: string;
  loggedInMarkerSelector: string;
  loggedOutMarkerSelector: string;
  authenticatedUrlPattern: string;
  loginFailureMarkerSelector: string;
  logoutKind: 'url' | 'click';
  logoutUrl: string;
  logoutSelector: string;
  logoutConfirmSelector: string;
  loggedOutUrlPattern: string;
  captchaMarkerSelector: string;
  mfaMarkerSelector: string;
  currentAccountMarker: string;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function setOrDelete(target: Record<string, unknown>, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) target[key] = trimmed;
  else delete target[key];
}

function openEditorState(system: OASystem): SystemEditorState {
  const config = isRecordValue(system.adapterConfig) ? system.adapterConfig : {};
  const submit = isRecordValue(config.submitTrigger) ? config.submitTrigger : {};
  const logout = isRecordValue(config.logoutTrigger) ? config.logoutTrigger : {};

  return {
    id: system.id,
    name: system.name,
    enabled: system.enabled,
    origins: system.origins.join('\n'),
    urlSignatures: (system.urlSignatures ?? []).join('\n'),
    loginUrl: system.loginUrl,
    homeUrl: system.homeUrl ?? '',
    loginPageUrlPattern: asString(config.loginPageUrlPattern),
    loginFormReadySelector: asString(config.loginFormReadySelector),
    usernameFieldSelector: asString(config.usernameFieldSelector),
    passwordFieldSelector: asString(config.passwordFieldSelector),
    submitKind: submit.kind === 'click' ? 'click' : 'formSubmit',
    submitSelector: asString(submit.selector),
    loggedInMarkerSelector: asString(config.loggedInMarkerSelector),
    loggedOutMarkerSelector: asString(config.loggedOutMarkerSelector),
    authenticatedUrlPattern: asString(config.authenticatedUrlPattern),
    loginFailureMarkerSelector: asString(config.loginFailureMarkerSelector),
    logoutKind: logout.kind === 'click' ? 'click' : 'url',
    logoutUrl: asString(logout.url),
    logoutSelector: asString(logout.selector),
    logoutConfirmSelector: asString(logout.confirmSelector),
    loggedOutUrlPattern: asString(config.loggedOutUrlPattern),
    captchaMarkerSelector: asString(config.captchaMarkerSelector),
    mfaMarkerSelector: asString(config.mfaMarkerSelector),
    currentAccountMarker: asString(config.currentAccountMarker),
  };
}

export function SystemsSection({ systems, activeSystemId, reload }: SystemsSectionProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editor, setEditor] = useState<SystemEditorState | null>(null);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OASystem | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ system: OASystem; accountCount: number } | null>(
    null,
  );
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [draftValues, setDraftValues] = useState<DraftValues>({});
  const [discovering, setDiscovering] = useState(false);
  const [presetApplied, setPresetApplied] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ missing: string[] } | null>(null);
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const [selfCheckBusy, setSelfCheckBusy] = useState(false);
  const [selfCheck, setSelfCheck] = useState<{ name: string; result: SelfCheckResult } | null>(null);
  const [selfCheckMessage, setSelfCheckMessage] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const readUrlOrigin = (): string | null => {
    try {
      const parsed = new URL(form.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.origin;
    } catch {
      return null;
    }
  };

  const handleDiscover = async () => {
    setMessage(null);
    setDiscovery(null);
    setDraftValues({});
    setPresetApplied(false);
    const origin = readUrlOrigin();
    if (!origin) {
      setMessage('请先填写以 http:// 或 https:// 开头的登录页网址');
      return;
    }

    // 权限申请必须发生在点击手势内：await 之前不能插入任何异步操作
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch (cause) {
      log.error('options-discovery-permission-failed', cause, { origin });
      setMessage('无法申请该网址的权限');
      return;
    }
    if (!granted) {
      setMessage(`未授予 ${origin} 的权限，无法自动识别`);
      return;
    }

    setDiscovering(true);
    try {
      const result = await callBackground(
        'system.discover',
        { url: form.url.trim(), vendor: form.vendor },
        { timeoutMs: 30_000 },
      );
      const values: DraftValues = {};
      for (const field of result.fields) values[field.key] = field.value;
      setDiscovery(result);
      setDraftValues(values);
      setMessage('自动识别完成，请逐项确认后保存');
    } catch (cause) {
      setMessage(describeError(cause));
    } finally {
      setDiscovering(false);
    }
  };

  /** 按 OA 类型填充预设：只依赖 origin，不依赖具体域名。 */
  const applyLandrayPreset = (): boolean => {
    const origin = readUrlOrigin();
    if (!origin) {
      setMessage('请先填写以 http:// 或 https:// 开头的登录页网址，再应用蓝凌预设');
      return false;
    }
    const built = buildPresetDiscovery(form.url.trim(), origin);
    setDiscovery(built.result);
    setDraftValues(built.values);
    setPresetApplied(true);
    setMessage(`已按蓝凌预设 v${LANDRAY_PRESET_VERSION} 填充，可逐项覆盖后保存`);
    return true;
  };

  const handleVendorChange = (next: OaVendor) => {
    setForm((prev) => ({ ...prev, vendor: next }));
    setMessage(null);
    if (next === 'landray') applyLandrayPreset();
    else {
      setPresetApplied(false);
      setDiscovery(null);
      setDraftValues({});
    }
  };

  const doSave = async () => {
    const origin = readUrlOrigin();
    if (!origin) {
      setPendingSave(null);
      setMessage('网址格式不正确');
      return;
    }
    setPendingSave(null);
    await run(async () => {
      await callBackground('system.create', {
        draft: {
          name: form.name.trim(),
          vendor: form.vendor,
          enabled: true,
          origins: [origin],
          urlSignatures: splitLines(draftValues.urlSignatures),
          loginUrl: form.url.trim(),
          homeUrl: deriveHomeUrl(draftValues.authenticatedUrlPattern),
          adapterConfig: buildAdapterConfig(draftValues, presetApplied && form.vendor === 'landray'),
        },
      });
      setForm(EMPTY_FORM);
      setDiscovery(null);
      setDraftValues({});
      setPresetApplied(false);
      setMessage(
        '系统已保存。打开该 OA 页面后点列表里的「自检」可验证配置与预设命中情况；缺项会在切换时报 E_CONFIG_MISSING',
      );
    });
  };

  const handleSaveRequest = () => {
    setMessage(null);
    if (form.name.trim().length === 0) {
      setMessage('请填写系统名称');
      return;
    }
    if (!readUrlOrigin()) {
      setMessage('请填写以 http:// 或 https:// 开头的登录页网址');
      return;
    }
    if (!discovery) {
      setPendingSave({ missing: ['尚未执行「自动识别」，所有适配字段都需要手工补齐'] });
      return;
    }
    const missing = discovery.fields
      .filter((field) => {
        // 退出方式为 click 时，退出地址不是必需项，避免预设流程总是弹「缺项」确认
        if (field.key === 'logoutUrl' && (draftValues.logoutKind ?? '') === 'click') return false;
        return (draftValues[field.key] ?? '').trim().length === 0;
      })
      .map((field) => field.label);
    if (missing.length === 0) {
      void doSave();
      return;
    }
    setPendingSave({ missing });
  };

  const handleSaveEdit = async () => {
    if (!editor) return;
    setBusy(true);
    setEditorMessage(null);
    try {
      const source = systems.find((system) => system.id === editor.id);
      const config: Record<string, unknown> = {
        ...(isRecordValue(source?.adapterConfig) ? source.adapterConfig : {}),
      };

      if (source?.vendor === 'landray') {
        setOrDelete(config, 'loginPageUrlPattern', editor.loginPageUrlPattern);
        setOrDelete(config, 'loginFormReadySelector', editor.loginFormReadySelector);
        setOrDelete(config, 'usernameFieldSelector', editor.usernameFieldSelector);
        setOrDelete(config, 'passwordFieldSelector', editor.passwordFieldSelector);
        setOrDelete(config, 'loggedInMarkerSelector', editor.loggedInMarkerSelector);
        setOrDelete(config, 'loggedOutMarkerSelector', editor.loggedOutMarkerSelector);
        setOrDelete(config, 'authenticatedUrlPattern', editor.authenticatedUrlPattern);
        setOrDelete(config, 'loginFailureMarkerSelector', editor.loginFailureMarkerSelector);
        setOrDelete(config, 'loggedOutUrlPattern', editor.loggedOutUrlPattern);
        setOrDelete(config, 'captchaMarkerSelector', editor.captchaMarkerSelector);
        setOrDelete(config, 'mfaMarkerSelector', editor.mfaMarkerSelector);
        setOrDelete(config, 'currentAccountMarker', editor.currentAccountMarker);

        if (editor.submitSelector.trim()) {
          config.submitTrigger = {
            kind: editor.submitKind,
            selector: editor.submitSelector.trim(),
          };
        } else {
          delete config.submitTrigger;
        }

        if (editor.logoutKind === 'url') {
          if (editor.logoutUrl.trim()) {
            config.logoutTrigger = { kind: 'url', url: editor.logoutUrl.trim() };
          } else {
            delete config.logoutTrigger;
          }
        } else if (editor.logoutSelector.trim()) {
          config.logoutTrigger = {
            kind: 'click',
            selector: editor.logoutSelector.trim(),
            ...(editor.logoutConfirmSelector.trim()
              ? { confirmSelector: editor.logoutConfirmSelector.trim() }
              : {}),
          };
        } else {
          delete config.logoutTrigger;
        }
      }

      await callBackground('system.update', {
        id: editor.id,
        patch: {
          name: editor.name.trim(),
          enabled: editor.enabled,
          origins: editor.origins
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
          urlSignatures: editor.urlSignatures
            .split('\n')
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
          loginUrl: editor.loginUrl.trim(),
          homeUrl: editor.homeUrl.trim() === '' ? null : editor.homeUrl.trim(),
          adapterConfig: config,
        },
      });
      setEditor(null);
      setMessage('系统配置已保存');
      await reload();
    } catch (cause) {
      setEditorMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (system: OASystem) => {
    setMessage(null);
    await run(async () => {
      await callBackground('system.update', { id: system.id, patch: { enabled: !system.enabled } });
    });
  };

  const handleSetActive = async (system: OASystem) => {
    setMessage(null);
    await run(async () => {
      await callBackground('settings.update', { patch: { activeSystemId: system.id } });
    });
  };

  const performDelete = async (target: OASystem, deleteAccounts: boolean) => {
    setBusy(true);
    setDeleteMessage(null);
    try {
      const result = await callBackground('system.delete', {
        id: target.id,
        deleteAccounts,
      });
      setPendingDelete(null);
      setDeleteBlocked(null);

      const notes = [`已删除「${target.name}」`];
      if (result.deletedAccountCount > 0) {
        notes.push(`同时删除 ${result.deletedAccountCount} 个账号`);
      }
      if (result.deletedAccountCount > 0 && result.credentialCleanup !== 'removed') {
        notes.push('保险库锁定时账号密文会保留，稍后可在保险库设置中清理');
      }
      if (result.permissionWarning) {
        notes.push('域名权限可能残留（不影响配置已删除），可到 chrome://extensions 手动移除');
      }
      setDeleteMessage(notes.join('；'));
      await reload();
    } catch (cause) {
      if (cause instanceof FlowError && cause.code === 'E_SYSTEM_IN_USE') {
        const accountCount =
          typeof cause.detail?.accountCount === 'number' ? cause.detail.accountCount : 0;
        setPendingDelete(null);
        setDeleteBlocked({ system: target, accountCount });
        setDeleteMessage(
          `无法删除「${target.name}」：仍有 ${accountCount} 个账号归属该系统。请先删除或迁移这些账号，或选择连同账号一起删除。`,
        );
      } else {
        setDeleteMessage(`删除失败：${describeError(cause)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    void performDelete(pendingDelete, false);
  };

  const handleDeleteWithAccounts = () => {
    if (!deleteBlocked) return;
    void performDelete(deleteBlocked.system, true);
  };

  const handleGrant = async (system: OASystem) => {
    setGrantMessage(null);
    setBusy(true);
    try {
      // 必须在点击手势内直接发起权限申请：request 之前不得有任何 await
      const origins = system.origins.map((origin) => `${origin}/*`);
      const granted = await chrome.permissions.request({ origins });
      if (!granted) {
        setGrantMessage(`未授予权限（${origins.join(', ')}），页面脚本不会注入`);
        return;
      }
      await callBackground('permission.ensure', { systemId: system.id });
      setGrantMessage('已授权，刷新 OA 页面后生效');
      await reload();
    } catch (cause) {
      // 权限申请被拒绝时错误码往往不是 FlowError；保留控制台证据，界面不吞掉失败
      log.error('options-grant-permission-failed', cause, { systemId: system.id });
      setGrantMessage(`授权失败：${describeError(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const closeSelfCheck = () => {
    setSelfCheckOpen(false);
    setSelfCheck(null);
    setSelfCheckMessage(null);
  };

  const handleSelfCheck = async (system: OASystem) => {
    setSelfCheckOpen(true);
    setSelfCheck(null);
    setSelfCheckMessage(null);
    setSelfCheckBusy(true);
    try {
      const result = await callBackground(
        'system.selfCheck',
        { systemId: system.id },
        { timeoutMs: 15_000 },
      );
      setSelfCheck({ name: system.name, result });
    } catch (cause) {
      setSelfCheckMessage(describeError(cause));
    } finally {
      setSelfCheckBusy(false);
    }
  };

  const editingSystem = editor ? systems.find((system) => system.id === editor.id) ?? null : null;

  return (
    <section className="flex flex-col gap-3">
      <div className="card p-3">
        <h2 className="text-[14px] font-semibold">已配置系统</h2>
        {deleteMessage ? (
          <p
            data-testid="delete-message"
            className={`mt-2 text-[12px] ${deleteMessage.startsWith('已删除') ? 'text-success' : 'text-danger'}`}
          >
            {deleteMessage}
          </p>
        ) : null}
        {systems.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">还没有 OA 系统，先在下方添加一个。</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {systems.map((system) => (
              <li key={system.id} className="rounded-oa border border-border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium">
                      {system.name}
                      {system.id === activeSystemId ? (
                        <span className="ml-1 text-[11px] text-accent">当前</span>
                      ) : null}
                      {!system.enabled ? (
                        <span className="ml-1 text-[11px] text-muted">已停用</span>
                      ) : null}
                    </p>
                    <p className="code text-[11px] text-muted">
                      {system.vendor} · {system.origins.join(', ')}
                    </p>
                    <p className="text-[11px] text-muted">
                      权限：{PERMISSION_LABELS[system.permissionState]} · 登录页：{system.loginUrl}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button disabled={busy} onClick={() => void handleSelfCheck(system)}>
                      自检
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setMessage(null);
                        setEditorMessage(null);
                        setEditor(openEditorState(system));
                      }}
                    >
                      编辑
                    </Button>
                    <Button disabled={busy || system.id === activeSystemId} onClick={() => void handleSetActive(system)}>
                      设为当前
                    </Button>
                    <Button disabled={busy} onClick={() => void handleGrant(system)}>
                      授权域名
                    </Button>
                    <Button disabled={busy} onClick={() => void handleToggle(system)}>
                      {system.enabled ? '停用' : '启用'}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        setDeleteMessage(null);
                        setDeleteBlocked(null);
                        setPendingDelete(system);
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {grantMessage ? (
          <p className="mt-2 text-[12px] text-muted" data-testid="grant-message">
            {grantMessage}
          </p>
        ) : null}
      </div>

      <div className="card p-3">
        <h2 className="text-[14px] font-semibold">添加 OA 系统</h2>
        <p className="mt-1 text-[11px] text-muted">
          只需填写名称和登录页网址。选择「OA 类型 = 蓝凌」会直接套用厂商预设（已在两个真实环境交叉校验，
          含登录后与退出字段）；「自动识别」会在后台临时打开该页面做只读扫描（不登录、不提交、不读取密码），
          识别不出来的字段会明确标为「需人工确认」。
        </p>
        <div className="mt-2 grid gap-2">
          <Field label="名称" htmlFor="system-name">
            <input
              id="system-name"
              className={inputClass}
              value={form.name}
              maxLength={32}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </Field>

          <Field
            label="登录页网址"
            htmlFor="system-url"
            hint="例如 http://oa.example.com/login.jsp；origin 与登录地址会自动从该网址推导。"
          >
            <input
              id="system-url"
              className={inputClass}
              value={form.url}
              placeholder="http://oa.example.com/login.jsp"
              onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
            />
          </Field>

          <Field
            label="OA 类型"
            htmlFor="system-vendor"
            hint="选择「蓝凌」会按厂商预设自动填充适配配置（可逐项覆盖）；未指定时只做通用结构识别。"
          >
            <select
              id="system-vendor"
              className={inputClass}
              value={form.vendor}
              onChange={(event) => handleVendorChange(event.target.value as OaVendor)}
            >
              <option value="other">未指定 / 其他</option>
              <option value="landray">蓝凌（landray）</option>
            </select>
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={busy || discovering}
              onClick={() => void handleDiscover()}
            >
              {discovering ? '识别中…' : '自动识别'}
            </Button>
            <Button
              variant="subtle"
              disabled={busy || discovering || form.vendor !== 'landray'}
              onClick={() => applyLandrayPreset()}
            >
              应用蓝凌预设
            </Button>
            <Button variant="subtle" disabled={busy || discovering} onClick={handleSaveRequest}>
              保存系统
            </Button>
            {presetApplied ? (
              <span className="text-[11px] text-accent">预设 v{LANDRAY_PRESET_VERSION}</span>
            ) : null}
            {message ? <span className="text-[12px] text-muted">{message}</span> : null}
          </div>
        </div>

        {discovery ? (
          <div className="mt-3 rounded-oa border border-border p-2" data-testid="discovery-draft">
            <p className="text-[12px] font-medium">识别结果（可逐项修改）</p>
            <p className="mt-1 text-[11px] text-muted">
              页面：{discovery.finalUrl}
              {discovery.title ? ` · ${discovery.title}` : ''}
            </p>
            {discovery.notes.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-[11px] text-muted">
                {discovery.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}

            <ul className="mt-2 flex flex-col gap-2">
              {discovery.fields.map((field) => {
                const value = draftValues[field.key] ?? '';
                const options = SELECT_OPTIONS[field.key];
                return (
                  <li key={field.key} className="rounded-oa border border-border p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] text-text">{field.label}</span>
                      <span className={`text-[11px] ${DISCOVERY_STATUS_CLASSES[field.status]}`}>
                        {DISCOVERY_STATUS_LABELS[field.status]}
                      </span>
                    </div>

                    {options ? (
                      <select
                        className={`${inputClass} mt-1`}
                        aria-label={field.label}
                        value={value}
                        onChange={(event) =>
                          setDraftValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                        }
                      >
                        {options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.key === 'urlSignatures' ? (
                      <textarea
                        className={`${inputClass} mt-1`}
                        aria-label={field.label}
                        rows={2}
                        value={value}
                        onChange={(event) =>
                          setDraftValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                        }
                      />
                    ) : (
                      <input
                        className={`${inputClass} mt-1`}
                        aria-label={field.label}
                        value={value}
                        onChange={(event) =>
                          setDraftValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                        }
                      />
                    )}

                    {field.evidence.length > 0 ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-muted">
                          识别依据（{field.evidence.length} 条）
                        </summary>
                        <ul className="mt-1 list-disc pl-4 text-[11px] text-muted">
                          {field.evidence.map((evidence) => (
                            <li key={`${evidence.label}-${evidence.detail}`}>
                              {evidence.label}：{evidence.detail}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <p className="mt-2 text-[11px] text-muted">
              留空的字段不会被写入配置；切换时缺项会报 E_CONFIG_MISSING 并列出缺哪一项。
            </p>
          </div>
        ) : null}
      </div>

      <Modal
        open={pendingSave !== null}
        title="仍有字段未确认"
        confirmLabel={busy ? '保存中…' : '仍然保存'}
        confirmVariant="primary"
        wide
        onConfirm={() => void doSave()}
        onClose={() => setPendingSave(null)}
      >
        <p>以下字段没有值（未自动识别或需要人工确认）：</p>
        <ul className="mt-1 list-disc pl-4">
          {(pendingSave?.missing ?? []).map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <p className="mt-2">
          仍可保存，但切换时会报 E_CONFIG_MISSING 并列出缺失项，扩展不会用猜测值代替。
        </p>
      </Modal>

      <Modal
        open={selfCheckOpen}
        title={selfCheck ? `自检：${selfCheck.name}` : '自检'}
        confirmLabel="关闭"
        confirmVariant="subtle"
        wide
        onConfirm={closeSelfCheck}
        onClose={closeSelfCheck}
      >
        {selfCheckBusy ? (
          <p>正在当前标签页做只读检查（不登录、不提交）…</p>
        ) : selfCheckMessage ? (
          <p className="text-danger">{selfCheckMessage}</p>
        ) : selfCheck ? (
          <div data-testid="self-check-result">
            <p>页面：{selfCheck.result.url}</p>
            <p className={`mt-1 ${SELF_CHECK_STATE_CLASSES[selfCheck.result.state]}`}>
              当前判定：{SELF_CHECK_STATE_LABELS[selfCheck.result.state]}
            </p>
            {selfCheck.result.notes.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {selfCheck.result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}

            {selfCheck.result.preset ? (
              <div
                className={`mt-2 rounded-oa border p-2 ${
                  selfCheck.result.preset.stale ? 'border-danger' : 'border-border'
                }`}
                data-testid="self-check-preset"
              >
                <p
                  className={`text-[12px] font-medium ${
                    selfCheck.result.preset.stale ? 'text-danger' : 'text-success'
                  }`}
                >
                  预设 {selfCheck.result.preset.id} v{selfCheck.result.preset.version}：
                  {selfCheck.result.preset.stale ? '预设可能已过期' : '命中正常'}
                </p>
                <ul className="mt-1 list-disc pl-4 text-[11px]">
                  {selfCheck.result.preset.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                {selfCheck.result.preset.stale ? (
                  <p className="mt-1 text-[11px] text-muted">
                    可继续在「编辑」里逐项替换为当前页面的实际选择器，或重新执行自动识别。
                  </p>
                ) : null}
              </div>
            ) : null}

            {selfCheck.result.fields.length === 0 ? (
              <p className="mt-2">该系统尚未配置任何选择器。</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {selfCheck.result.fields.map((field) => (
                  <li key={`${field.key}-${field.selector}`} className="rounded-oa border border-border p-1">
                    <span className="text-text">{field.label}</span>
                    <span className="code ml-1">{field.selector}</span>
                    <span className="ml-1">
                      {field.count === null
                        ? `无法统计（${field.error ?? 'unknown'}）`
                        : `命中 ${field.count}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={editor !== null}
        title="编辑 OA 系统"
        wide
        confirmLabel={busy ? '保存中…' : '保存'}
        confirmVariant="primary"
        onConfirm={() => void handleSaveEdit()}
        onClose={() => setEditor(null)}
      >
        {editor ? (
          <div className="flex flex-col gap-3">
            {editorMessage ? <p className="text-[11px] text-danger">{editorMessage}</p> : null}

            <div className="grid gap-2 md:grid-cols-2">
              <p className="text-[11px] font-medium text-text md:col-span-2">
                基础信息（厂商：{editingSystem?.vendor ?? ''}）
              </p>

              <Field label="名称" htmlFor="system-edit-name">
                <input
                  id="system-edit-name"
                  className={inputClass}
                  maxLength={32}
                  value={editor.name}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </Field>

              <Field label="登录页 URL" htmlFor="system-edit-login-url">
                <input
                  id="system-edit-login-url"
                  className={inputClass}
                  value={editor.loginUrl}
                  onChange={(event) => setEditor({ ...editor, loginUrl: event.target.value })}
                />
              </Field>

              <Field label="首页 URL（可选）" htmlFor="system-edit-home-url">
                <input
                  id="system-edit-home-url"
                  className={inputClass}
                  value={editor.homeUrl}
                  onChange={(event) => setEditor({ ...editor, homeUrl: event.target.value })}
                />
              </Field>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={editor.enabled}
                    onChange={(event) => setEditor({ ...editor, enabled: event.target.checked })}
                  />
                  启用（启用后才会动态注入页面脚本）
                </label>
              </div>

              <div className="md:col-span-2">
                <Field
                  label="域名 origin"
                  htmlFor="system-edit-origins"
                  hint="每行一个，仅协议 + 主机 + 端口，例如 https://oa.example.com；不要带路径。"
                >
                  <textarea
                    id="system-edit-origins"
                    className={inputClass}
                    rows={2}
                    value={editor.origins}
                    onChange={(event) => setEditor({ ...editor, origins: event.target.value })}
                  />
                </Field>
              </div>

              <div className="md:col-span-2">
                <Field
                  label="URL 签名（可选）"
                  htmlFor="system-edit-url-signatures"
                  hint="每行一个，支持完整 URL、glob（* / ?）或 re: 前缀正则；同域名多系统时用于按登录路径区分，留空则回退到登录页/首页。"
                >
                  <textarea
                    id="system-edit-url-signatures"
                    className={inputClass}
                    rows={2}
                    value={editor.urlSignatures}
                    onChange={(event) => setEditor({ ...editor, urlSignatures: event.target.value })}
                  />
                </Field>
              </div>
            </div>

            {editingSystem?.vendor === 'landray' ? (
              <div className="grid gap-2 md:grid-cols-2">
                <div className="md:col-span-2">
                  <p className="text-[11px] font-medium text-text">蓝凌适配配置</p>
                  <p className="mt-1 text-[11px] text-muted">
                    以下内容必须来自真实页面；留空即未配置，缺失必需项时切换会报配置缺失，扩展不会猜测选择器。
                  </p>
                </div>

                <Field
                  label="登录页 URL 规则"
                  htmlFor="system-edit-login-pattern"
                  hint="支持完整 URL、glob（* / ?）或 re: 前缀正则。"
                >
                  <input
                    id="system-edit-login-pattern"
                    className={inputClass}
                    value={editor.loginPageUrlPattern}
                    onChange={(event) =>
                      setEditor({ ...editor, loginPageUrlPattern: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="登录表单就绪标记"
                  htmlFor="system-edit-login-form"
                  hint="登录表单可填写时存在的元素选择器。"
                >
                  <input
                    id="system-edit-login-form"
                    className={inputClass}
                    value={editor.loginFormReadySelector}
                    onChange={(event) =>
                      setEditor({ ...editor, loginFormReadySelector: event.target.value })
                    }
                  />
                </Field>

                <Field label="用户名输入框" htmlFor="system-edit-username" hint="真实登录页的用户名字段选择器。">
                  <input
                    id="system-edit-username"
                    className={inputClass}
                    value={editor.usernameFieldSelector}
                    onChange={(event) =>
                      setEditor({ ...editor, usernameFieldSelector: event.target.value })
                    }
                  />
                </Field>

                <Field label="密码输入框" htmlFor="system-edit-password" hint="真实登录页的密码字段选择器。">
                  <input
                    id="system-edit-password"
                    className={inputClass}
                    value={editor.passwordFieldSelector}
                    onChange={(event) =>
                      setEditor({ ...editor, passwordFieldSelector: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="提交方式"
                  htmlFor="system-edit-submit-kind"
                  hint="formSubmit 在匹配元素所在表单上提交；click 直接点击匹配元素。"
                >
                  <select
                    id="system-edit-submit-kind"
                    className={inputClass}
                    value={editor.submitKind}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        submitKind: event.target.value as SystemEditorState['submitKind'],
                      })
                    }
                  >
                    <option value="formSubmit">formSubmit（表单提交）</option>
                    <option value="click">click（点击按钮）</option>
                  </select>
                </Field>

                <Field label="提交元素" htmlFor="system-edit-submit-selector" hint="提交按钮或表单内元素的选择器。">
                  <input
                    id="system-edit-submit-selector"
                    className={inputClass}
                    value={editor.submitSelector}
                    onChange={(event) => setEditor({ ...editor, submitSelector: event.target.value })}
                  />
                </Field>

                <Field
                  label="已登录标记"
                  htmlFor="system-edit-logged-in"
                  hint="仅登录后才存在的元素，用于状态判定与成功检测。"
                >
                  <input
                    id="system-edit-logged-in"
                    className={inputClass}
                    value={editor.loggedInMarkerSelector}
                    onChange={(event) =>
                      setEditor({ ...editor, loggedInMarkerSelector: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="未登录标记"
                  htmlFor="system-edit-logged-out"
                  hint="仅未登录时存在的元素。"
                >
                  <input
                    id="system-edit-logged-out"
                    className={inputClass}
                    value={editor.loggedOutMarkerSelector}
                    onChange={(event) =>
                      setEditor({ ...editor, loggedOutMarkerSelector: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="登录成功 URL 规则"
                  htmlFor="system-edit-auth-pattern"
                  hint="与已登录标记任一命中即判定成功。"
                >
                  <input
                    id="system-edit-auth-pattern"
                    className={inputClass}
                    value={editor.authenticatedUrlPattern}
                    onChange={(event) =>
                      setEditor({ ...editor, authenticatedUrlPattern: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="登录失败提示"
                  htmlFor="system-edit-failure"
                  hint="错误提示元素；命中时优先级高于成功证据。"
                >
                  <input
                    id="system-edit-failure"
                    className={inputClass}
                    value={editor.loginFailureMarkerSelector}
                    onChange={(event) =>
                      setEditor({ ...editor, loginFailureMarkerSelector: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="退出方式"
                  htmlFor="system-edit-logout-kind"
                  hint="退出地址或退出按钮，必须来自真实系统。"
                >
                  <select
                    id="system-edit-logout-kind"
                    className={inputClass}
                    value={editor.logoutKind}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        logoutKind: event.target.value as SystemEditorState['logoutKind'],
                      })
                    }
                  >
                    <option value="url">url（访问退出地址）</option>
                    <option value="click">click（点击退出入口）</option>
                  </select>
                </Field>

                {editor.logoutKind === 'url' ? (
                  <Field label="退出地址" htmlFor="system-edit-logout-url">
                    <input
                      id="system-edit-logout-url"
                      className={inputClass}
                      value={editor.logoutUrl}
                      onChange={(event) => setEditor({ ...editor, logoutUrl: event.target.value })}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="退出入口" htmlFor="system-edit-logout-selector">
                      <input
                        id="system-edit-logout-selector"
                        className={inputClass}
                        value={editor.logoutSelector}
                        onChange={(event) =>
                          setEditor({ ...editor, logoutSelector: event.target.value })
                        }
                      />
                    </Field>

                    <Field
                      label="退出二次确认（可选）"
                      htmlFor="system-edit-logout-confirm"
                      hint="若退出需要再次点击确认，填写该确认按钮选择器。"
                    >
                      <input
                        id="system-edit-logout-confirm"
                        className={inputClass}
                        value={editor.logoutConfirmSelector}
                        onChange={(event) =>
                          setEditor({ ...editor, logoutConfirmSelector: event.target.value })
                        }
                      />
                    </Field>
                  </>
                )}

                <Field
                  label="退出后 URL 规则"
                  htmlFor="system-edit-logged-out-pattern"
                  hint="用于确认已登出；也可改用未登录标记。"
                >
                  <input
                    id="system-edit-logged-out-pattern"
                    className={inputClass}
                    value={editor.loggedOutUrlPattern}
                    onChange={(event) =>
                      setEditor({ ...editor, loggedOutUrlPattern: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="验证码标记（可选）"
                  htmlFor="system-edit-captcha"
                  hint="出现即中止，不做绕过。"
                >
                  <input
                    id="system-edit-captcha"
                    className={inputClass}
                    value={editor.captchaMarkerSelector}
                    onChange={(event) =>
                      setEditor({ ...editor, captchaMarkerSelector: event.target.value })
                    }
                  />
                </Field>

                <Field
                  label="MFA 标记（可选）"
                  htmlFor="system-edit-mfa"
                  hint="出现即中止，不做绕过。"
                >
                  <input
                    id="system-edit-mfa"
                    className={inputClass}
                    value={editor.mfaMarkerSelector}
                    onChange={(event) => setEditor({ ...editor, mfaMarkerSelector: event.target.value })}
                  />
                </Field>

                <Field
                  label="当前账号标记（可选）"
                  htmlFor="system-edit-current-account"
                  hint="用于识别当前登录账号；留空则不做身份判断。"
                >
                  <input
                    id="system-edit-current-account"
                    className={inputClass}
                    value={editor.currentAccountMarker}
                    onChange={(event) =>
                      setEditor({ ...editor, currentAccountMarker: event.target.value })
                    }
                  />
                </Field>
              </div>
            ) : (
              <p className="text-[11px] text-muted">该厂商暂不支持适配配置。</p>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        title="删除 OA 系统"
        confirmLabel={busy ? '删除中…' : '删除'}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      >
        确认删除「{pendingDelete?.name ?? ''}」？若仍有账号归属该系统，会先拒绝并列出账号数量，你可以在下一步选择连同账号一起删除。
      </Modal>

      <Modal
        open={deleteBlocked !== null}
        title="无法删除：仍有账号引用"
        confirmLabel={busy ? '删除中…' : `同时删除 ${deleteBlocked?.accountCount ?? 0} 个账号`}
        confirmVariant="danger"
        onConfirm={handleDeleteWithAccounts}
        onClose={() => setDeleteBlocked(null)}
      >
        系统「{deleteBlocked?.system.name ?? ''}」仍有 {deleteBlocked?.accountCount ?? 0} 个账号。
        请先删除或迁移这些账号；也可以直接连账号一起删除。删除账号会同时清理其保险库密文（保险库锁定时密文会保留）。
      </Modal>
    </section>
  );
}
