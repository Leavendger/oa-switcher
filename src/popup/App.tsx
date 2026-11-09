import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError } from '../errors/messages.zh-CN';
import { callBackground } from '../shared/messaging/client';
import type { Account } from '../shared/types/account';
import { isTerminalFlowState, type ContentPingData } from '../shared/types/flow';
import type { AccountId, SystemId } from '../shared/types/ids';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Toast } from '../ui/Toast';
import { applyTheme } from '../ui/theme';
import { useBootstrap } from '../ui/useBootstrap';
import { AccountList } from './components/AccountList';
import { FloatBallSettings } from './components/FloatBallSettings';
import { FlowStatus } from './components/FlowStatus';
import { OtherSystemsPanel } from './components/OtherSystemsPanel';
import { SwitchButton } from './components/SwitchButton';
import { SystemBadge } from './components/SystemBadge';
import { SystemPicker } from './components/SystemPicker';
import { UnrecognizedPagePanel } from './components/UnrecognizedPagePanel';
import { VaultGate } from './components/VaultGate';
import { useActiveTabResolution, useFlowPort } from './hooks';

export function App() {
  const { data, error, loading, reload, refresh } = useBootstrap();
  const { resolution, error: resolutionError, refresh: refreshResolution } = useActiveTabResolution();
  // SW 回收 / 保险库状态广播后静默重拉，确保显示的 vault 状态与后台一致
  const snapshot = useFlowPort(refresh);
  const [selectedId, setSelectedId] = useState<AccountId | null>(null);
  const [confirming, setConfirming] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [unlockRequest, setUnlockRequest] = useState(0);
  const [ping, setPing] = useState<ContentPingData | null>(null);
  const [pingMessage, setPingMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<SystemId | null>(null);
  const [pickerConfirmed, setPickerConfirmed] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(true);
  const [manualSystemId, setManualSystemId] = useState<SystemId | null>(null);
  const [otherSystemsOpen, setOtherSystemsOpen] = useState(false);

  const settings = data?.settings;
  const vaultState = data?.vault.state ?? 'uninitialized';
  const systems = data?.systems ?? [];

  useEffect(() => {
    applyTheme(settings?.theme ?? 'system');
  }, [settings?.theme]);

  const openOptions = useCallback(() => {
    void chrome.runtime.openOptionsPage();
  }, []);

  // 活动页识别到的系统 > 歧义时用户所选 > 「查看其他系统」手选
  const recognizedSystemId: SystemId | null =
    resolution === null
      ? null
      : resolution.status === 'matched'
        ? resolution.systemId
        : resolution.status === 'ambiguous'
          ? pickerSelection
          : null;

  const activeSystemId = manualSystemId ?? recognizedSystemId;
  const activeSystem = systems.find((system) => system.id === activeSystemId) ?? null;

  const accounts = useMemo(() => {
    const all = data?.accounts ?? [];
    return activeSystemId ? all.filter((account) => account.systemId === activeSystemId) : [];
  }, [data?.accounts, activeSystemId]);

  const accountCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const account of data?.accounts ?? []) {
      counts[account.systemId] = (counts[account.systemId] ?? 0) + 1;
    }
    return counts;
  }, [data?.accounts]);

  const selected = accounts.find((account) => account.id === selectedId) ?? null;

  useEffect(() => {
    if (!data) return;
    if (selectedId && accounts.some((account) => account.id === selectedId)) return;
    setSelectedId(accounts.find((account) => account.enabled)?.id ?? null);
  }, [data, accounts, selectedId]);

  const showPicker =
    resolution?.status === 'ambiguous' && !pickerConfirmed && manualSystemId === null;
  const showUnrecognized =
    resolution !== null && resolution.status === 'none' && manualSystemId === null;
  const showAccounts = !showPicker && !showUnrecognized && activeSystem !== null;

  const originSystems = resolution?.originSystems ?? [];
  // 只有当前页面确属已配置系统时，才提供「在当前站点隐藏」这类站点级开关
  const tabOrigin = resolution?.origin ?? null;
  const siteOrigin =
    tabOrigin !== null && systems.some((item) => item.origins.includes(tabOrigin))
      ? tabOrigin
      : null;
  const systemAtOrigin = activeSystemId
    ? originSystems.find((candidate) => candidate.systemId === activeSystemId)
    : undefined;
  // 同 origin 多系统时，origin 命中不足以证明归属，必须命中该系统签名
  const sameOriginMulti = originSystems.length > 1;
  const ownedByOrigin = resolution === null ? true : systemAtOrigin !== undefined;
  const ownedBySignature =
    !sameOriginMulti || (systemAtOrigin?.matchedPattern ?? null) !== null;
  const ownershipOk = ownedByOrigin && ownedBySignature;

  const runFlow = useCallback(
    async (account: Account) => {
      setBusy(true);
      try {
        await callBackground('flow.start', {
          accountId: account.id,
          systemId: activeSystemId ?? undefined,
        });
        setToast('已发起切换请求，进度见下方状态');
      } catch (cause) {
        setToast(describeError(cause));
      } finally {
        setBusy(false);
      }
    },
    [activeSystemId],
  );

  const flowActive = snapshot !== null && !isTerminalFlowState(snapshot.state);

  const handleCancel = useCallback(async () => {
    const runId = snapshot?.runId;
    if (!runId) return;
    setCancelling(true);
    try {
      await callBackground('flow.cancel', { runId });
      setToast('已取消切换');
    } catch (cause) {
      setToast(describeError(cause));
    } finally {
      setCancelling(false);
    }
  }, [snapshot?.runId]);

  const handleSwitch = () => {
    if (!selected) return;
    if (vaultState !== 'unlocked') {
      // 懒解锁：只有点切换才要求解锁/初始化
      setUnlockRequest((value) => value + 1);
      return;
    }
    if (settings?.confirmBeforeSwitch) {
      setConfirming(selected);
      return;
    }
    void runFlow(selected);
  };

  const handleConfirm = () => {
    const target = confirming;
    setConfirming(null);
    if (target) void runFlow(target);
  };

  const handleUsePickedSystem = async () => {
    if (!pickerSelection) return;
    const rememberKey = resolution?.rememberKey ?? null;

    if (rememberChoice && rememberKey) {
      try {
        await callBackground('settings.update', {
          patch: {
            rememberedSystems: {
              ...(settings?.rememberedSystems ?? {}),
              [rememberKey]: pickerSelection,
            },
          },
        });
        await reload();
      } catch (cause) {
        setToast(describeError(cause));
        return;
      }
    }
    setPickerConfirmed(true);
  };

  const handleOpenOaTab = async () => {
    setBusy(true);
    try {
      await callBackground('system.openOaTab', { systemId: resolution?.systemId ?? undefined });
      setManualSystemId(null);
      setPickerConfirmed(false);
      setPickerSelection(null);
      await refreshResolution();
    } catch (cause) {
      setToast(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = loading
    ? '正在加载配置…'
    : error
      ? '配置加载失败，请重新打开 Popup'
      : !data
        ? '配置尚未加载'
        : systems.length === 0
          ? '尚未配置 OA 系统'
          : showPicker
            ? '请先选择当前页面所属的系统'
            : showUnrecognized
              ? '当前页面未识别，请先切到 OA 标签页'
              : !activeSystem
                ? '请选择一个系统'
                : !ownershipOk
                  ? `当前页面不属于「${activeSystem.name}」，请先切到该系统的页面`
                  : accounts.length === 0
                    ? `「${activeSystem.name}」尚未添加账号`
                    : !selected
                      ? '请选择一个账号'
                      : !selected.enabled
                        ? '该账号已停用'
                        : null;

  const clearToast = useCallback(() => setToast(null), []);

  const handlePing = async () => {
    setPing(null);
    setPingMessage(null);
    try {
      setPing(await callBackground('system.pingActiveTab', { systemId: activeSystemId ?? undefined }));
    } catch (cause) {
      setPingMessage(describeError(cause));
    }
  };

  const manualSelection = manualSystemId !== null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-semibold">OA Switcher</h1>
          {activeSystem ? (
            <SystemBadge
              name={activeSystem.name}
              basis={manualSelection ? null : (resolution?.basis ?? null)}
              manual={manualSelection}
            />
          ) : (
            <p className="text-[11px] text-muted">
              {resolution === null ? '正在识别当前页面…' : '未识别当前页面'}
            </p>
          )}
        </div>
        <Button onClick={openOptions}>设置</Button>
      </header>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      {resolutionError ? <p className="text-[12px] text-danger">{resolutionError}</p> : null}

      <VaultGate state={vaultState} unlockRequest={unlockRequest} onChanged={reload} />

      {showPicker && resolution ? (
        <SystemPicker
          candidates={resolution.candidates}
          selectedId={pickerSelection}
          remember={rememberChoice}
          busy={busy}
          onSelect={setPickerSelection}
          onRememberChange={setRememberChoice}
          onConfirm={() => void handleUsePickedSystem()}
        />
      ) : null}

      {showUnrecognized && resolution ? (
        <UnrecognizedPagePanel
          pageKind={resolution.pageKind}
          origin={resolution.origin}
          busy={busy}
          onOpenOaTab={() => void handleOpenOaTab()}
          onShowAllSystems={() => setOtherSystemsOpen(true)}
        />
      ) : null}

      {showAccounts && activeSystem ? (
        <>
          {manualSelection && !ownershipOk ? (
            <p className="text-[11px] text-danger">
              当前页面不属于「{activeSystem.name}」，切换前请先切到该系统的页面。
            </p>
          ) : null}
          <AccountList
            accounts={accounts}
            groups={data?.groups ?? []}
            grouping={settings?.preferredPopupGrouping ?? 'grouped'}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenOptions={openOptions}
            emptyTitle={`「${activeSystem.name}」还没有账号`}
            emptyHint="在设置页为该 OA 系统添加账号后即可切换。"
          />
        </>
      ) : null}

      {data && systems.length > 0 && !showPicker ? (
        <OtherSystemsPanel
          systems={systems}
          activeSystemId={activeSystemId}
          selectedId={manualSystemId}
          accountCounts={accountCounts}
          open={otherSystemsOpen}
          onToggle={() => setOtherSystemsOpen((value) => !value)}
          onSelectSystem={(id) => {
            setManualSystemId(id);
            setOtherSystemsOpen(false);
          }}
        />
      ) : null}

      <SwitchButton disabledReason={disabledReason} busy={busy || flowActive} onClick={handleSwitch} />

      {vaultState !== 'unlocked' && accounts.length > 0 ? (
        <p className="text-[11px] text-muted">
          {vaultState === 'uninitialized'
            ? '点击「切换账号」会先要求设置主密码。'
            : '点击「切换账号」会先要求解锁保险库（主密码只在后台内存派生密钥）。'}
        </p>
      ) : null}

      <div className="rounded-oa border border-border px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">页面注入检测</span>
          <Button onClick={() => void handlePing()}>检测当前页面</Button>
        </div>
        {ping ? (
          <p className="code mt-1 text-[10px] text-muted">
            {ping.title || ping.url}（{ping.adapterVersion}）
          </p>
        ) : null}
        {pingMessage ? <p className="mt-1 text-[11px] text-danger">{pingMessage}</p> : null}
      </div>

      <FloatBallSettings siteOrigin={siteOrigin} />

      <FlowStatus
        snapshot={snapshot}
        onRetry={() => (selected ? void runFlow(selected) : undefined)}
        onCancel={() => void handleCancel()}
        cancelling={cancelling}
      />

      <Modal
        open={confirming !== null}
        title="确认切换账号"
        confirmLabel="开始切换"
        confirmVariant="primary"
        onConfirm={handleConfirm}
        onClose={() => setConfirming(null)}
      >
        即将切换到「{confirming?.label ?? ''}」。切换会影响该 OA 在浏览器内的所有标签页。
      </Modal>

      <Toast message={toast} tone="danger" onDone={clearToast} />
    </div>
  );
}
