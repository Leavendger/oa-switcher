import { useState } from 'react';
import { describeError } from '../../errors/messages.zh-CN';
import { callBackground } from '../../shared/messaging/client';
import { isFlowError } from '../../shared/types/errors';
import {
  TRANSFER_MAX_CONTENT_BYTES,
  type TransferConflictMode,
  type TransferImportResult,
  type TransferMode,
  type TransferPreview,
  type TransferVaultMode,
} from '../../shared/types/transfer';
import { transferSectionLabel } from '../../shared/transferPackage';
import { Button } from '../../ui/Button';
import { Field, inputClass } from '../../ui/Field';
import { Modal } from '../../ui/Modal';

export interface DataTransferSectionProps {
  reload: () => Promise<void>;
}

const VAULT_ACTION_LABELS: Record<TransferImportResult['vaultAction'], string> = {
  unchanged: '未改动',
  skipped: '未导入凭证',
  adopted: '已接管备份凭证',
  merged: '已合并凭证',
  replaced: '已替换本机保险库',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function importErrorText(cause: unknown): string {
  if (isFlowError(cause)) {
    if (cause.code === 'E_MASTER_INVALID') {
      return '来源主密码与本机主密码不一致，未写入任何数据。请改选「只导入配置」，或勾选「清空本机保险库后导入」。';
    }
    if (
      cause.code === 'E_VALIDATION' &&
      cause.detail?.reason === 'too-large' &&
      typeof cause.detail.elapsedMs === 'number' &&
      typeof cause.detail.limit === 'number'
    ) {
      return `文件过大：实际 ${formatBytes(cause.detail.elapsedMs)}，上限 ${formatBytes(cause.detail.limit)}。`;
    }
    if (cause.code === 'E_TRANSFER_INVALID' && typeof cause.detail?.field === 'string') {
      return `${describeError(cause)}（问题段：${transferSectionLabel(cause.detail.field)}）`;
    }
  }
  return describeError(cause);
}

export function DataTransferSection({ reload }: DataTransferSectionProps) {
  const [mode, setMode] = useState<TransferMode>('full');
  const [busy, setBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<TransferConflictMode>('keep-both');
  const [vaultChoice, setVaultChoice] = useState<TransferVaultMode>('skip');
  const [sourceMasterPassword, setSourceMasterPassword] = useState('');
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [result, setResult] = useState<TransferImportResult | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setExportMessage(null);
    try {
      const exported = await callBackground('data.export', { mode });
      const blob = new Blob([exported.content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exported.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setExportMessage(`已导出 ${exported.fileName}（${formatBytes(exported.bytes)}）`);
    } catch (cause) {
      setExportMessage(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async (text: string, password?: string) => {
    setPreviewError(null);
    setImportMessage(null);
    setResult(null);
    try {
      const next = await callBackground('data.preview', {
        content: text,
        sourceMasterPassword: password || undefined,
      });
      setPreview(next);
      setVaultChoice(next.vault.canAdopt ? 'adopt' : 'skip');
      return next;
    } catch (cause) {
      setPreview(null);
      setPreviewError(importErrorText(cause));
      return null;
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setPreview(null);
    setResult(null);
    setImportMessage(null);
    setFileName(file.name);
    setSourceMasterPassword('');

    if (file.size > TRANSFER_MAX_CONTENT_BYTES) {
      setContent(null);
      setPreviewError(
        `文件过大：实际 ${formatBytes(file.size)}，上限 ${formatBytes(TRANSFER_MAX_CONTENT_BYTES)}。`,
      );
      return;
    }
    const text = await file.text();
    if (text.length > TRANSFER_MAX_CONTENT_BYTES) {
      setContent(null);
      setPreviewError(
        `文件过大：实际 ${text.length} 字符，上限 ${formatBytes(TRANSFER_MAX_CONTENT_BYTES)}。`,
      );
      return;
    }
    setContent(text);
    await runPreview(text);
  };

  const handleVerifyPassword = async () => {
    if (!content) return;
    setBusy(true);
    try {
      const next = await runPreview(content, sourceMasterPassword);
      if (!next) return;
      if (next.vault.passwordVerified === true && next.vault.sameAsTarget === true) {
        setImportMessage('来源主密码与本机一致，可以选择「合并双方凭证」。');
      } else if (next.vault.passwordVerified === true && next.vault.sameAsTarget === false) {
        setImportMessage('来源主密码与本机不一致，只能「只导入配置」或「清空本机保险库后导入」。');
      } else {
        setImportMessage('来源主密码无法解开备份中的凭证，请确认后重试。');
      }
    } finally {
      setBusy(false);
    }
  };

  const executeImport = async (confirmReplace: boolean) => {
    if (!content) return;
    setBusy(true);
    setImportMessage(null);
    try {
      const summary = await callBackground('data.import', {
        content,
        conflict,
        vault: vaultChoice,
        sourceMasterPassword: vaultChoice === 'merge' ? sourceMasterPassword : undefined,
        confirmReplace,
      });
      setResult(summary);
      setImportMessage('导入完成，未发生部分写入。');
      await reload();
      setContent(null);
      setPreview(null);
      setFileName(null);
      setSourceMasterPassword('');
    } catch (cause) {
      setImportMessage(importErrorText(cause));
    } finally {
      setConfirmReplaceOpen(false);
      setBusy(false);
    }
  };

  const handleImport = () => {
    if (vaultChoice === 'replace') {
      setConfirmReplaceOpen(true);
      return;
    }
    void executeImport(false);
  };

  const sameIdTotal = preview
    ? preview.diff.systems.sameId + preview.diff.accounts.sameId + preview.diff.groups.sameId
    : 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="card p-3">
        <h2 className="text-[14px] font-semibold">导出</h2>
        <p className="mt-1 text-[11px] text-muted">
          完整备份包含密码密文，导入后可用来源浏览器的主密码直接解锁；仅配置备份不含任何密码，导入后需要重新设置。导出过程不会解密，也不会出现明文密码。
        </p>

        <div className="mt-2 flex flex-col gap-2 text-[12px]">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="transfer-mode"
              checked={mode === 'full'}
              onChange={() => setMode('full')}
            />
            <span>
              完整备份（默认）
              <span className="block text-[11px] text-muted">含系统、账号、分组、设置、悬浮球偏好与凭证密文</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="transfer-mode"
              checked={mode === 'config'}
              onChange={() => setMode('config')}
            />
            <span>
              仅配置
              <span className="block text-[11px] text-muted">不含凭证，导入后账号存在但需要重新设置密码</span>
            </span>
          </label>
        </div>

        <div className="mt-3 rounded-oa border border-border bg-bg p-2 text-[11px] text-muted">
          备份文件的安全性等同于你的主密码强度。请勿放在共享目录、聊天工具或公开网盘；用完建议删除。
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void handleExport()}>
            导出备份文件
          </Button>
          {exportMessage ? <span className="text-[12px] text-muted">{exportMessage}</span> : null}
        </div>
      </div>

      <div className="card p-3">
        <h2 className="text-[14px] font-semibold">导入</h2>
        <p className="mt-1 text-[11px] text-muted">
          导入采用合并方式，不会静默覆盖本机数据。先选择文件预览影响范围，再确认执行。
        </p>

        <Field label="备份文件" htmlFor="transfer-import-file" hint="仅支持本扩展导出的 JSON 文件。">
          <input
            id="transfer-import-file"
            data-testid="transfer-import-file"
            className={inputClass}
            type="file"
            accept=".json,application/json"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </Field>

        {previewError ? (
          <p className="mt-2 text-[12px] text-danger" data-testid="transfer-preview-error">
            {previewError}
          </p>
        ) : null}

        {preview ? (
          <div className="mt-3 flex flex-col gap-3" data-testid="transfer-preview">
            <div className="rounded-oa border border-border bg-bg p-2 text-[12px]">
              <p className="font-medium">将导入：{fileName ?? '所选文件'}</p>
              <p className="mt-1 text-[11px] text-muted">
                模式：{preview.file.mode === 'full' ? '完整（含凭证）' : '仅配置（无凭证）'} ·
                导出时间：{new Date(preview.file.exportedAt).toLocaleString()} · 来源版本：
                {preview.file.appVersion}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                文件内：系统 {preview.file.systemCount} / 账号 {preview.file.accountCount} / 分组{' '}
                {preview.file.groupCount}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                本机现有：系统 {preview.target.systemCount} / 账号 {preview.target.accountCount} / 分组{' '}
                {preview.target.groupCount}
              </p>
            </div>

            <div className="rounded-oa border border-border p-2 text-[12px]">
              <p className="font-medium">影响范围</p>
              <ul className="mt-1 flex flex-col gap-1 text-[11px] text-muted">
                <li>
                  系统：新增 {preview.diff.systems.added}，同 ID {preview.diff.systems.sameId}
                </li>
                <li>
                  账号：新增 {preview.diff.accounts.added}，同 ID {preview.diff.accounts.sameId}
                </li>
                <li>
                  分组：新增 {preview.diff.groups.added}，同 ID {preview.diff.groups.sameId}
                </li>
              </ul>
            </div>

            {sameIdTotal > 0 ? (
              <div className="rounded-oa border border-border p-2 text-[12px]">
                <p className="font-medium">同 ID 冲突处理</p>
                <label className="mt-1 flex items-center gap-2">
                  <input
                    type="radio"
                    name="transfer-conflict"
                    checked={conflict === 'overwrite'}
                    onChange={() => setConflict('overwrite')}
                  />
                  覆盖本机同 ID 条目
                </label>
                <label className="mt-1 flex items-center gap-2">
                  <input
                    type="radio"
                    name="transfer-conflict"
                    checked={conflict === 'keep-both'}
                    onChange={() => setConflict('keep-both')}
                  />
                  保留双方（导入条目生成新 ID）
                </label>
                {conflict === 'keep-both' && preview.renames.length > 0 ? (
                  <div className="mt-2 text-[11px] text-muted" data-testid="transfer-renames">
                    <p>选择「保留双方」时以下条目会重命名：</p>
                    <ul className="mt-1 list-disc pl-5">
                      {preview.renames.map((rename) => (
                        <li key={`${rename.kind}-${rename.from}-${rename.to}`}>
                          {rename.from} → {rename.to}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {preview.vault.packageHasVault ? (
              <div className="rounded-oa border border-border p-2 text-[12px]">
                <p className="font-medium">本机保险库：{preview.vault.targetState === 'uninitialized' ? '未初始化' : preview.vault.targetState === 'locked' ? '已锁定' : '已解锁'}</p>

                {preview.vault.targetState === 'uninitialized' ? (
                  <>
                    <label className="mt-1 flex items-start gap-2">
                      <input
                        type="radio"
                        name="transfer-vault"
                        checked={vaultChoice === 'adopt'}
                        onChange={() => setVaultChoice('adopt')}
                      />
                      <span>
                        采用备份中的凭证
                        <span className="block text-[11px] text-muted">
                          导入后请使用来源浏览器的主密码解锁
                        </span>
                      </span>
                    </label>
                    <label className="mt-1 flex items-start gap-2">
                      <input
                        type="radio"
                        name="transfer-vault"
                        checked={vaultChoice === 'skip'}
                        onChange={() => setVaultChoice('skip')}
                      />
                      <span>不导入凭证</span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="mt-1 flex items-start gap-2">
                      <input
                        type="radio"
                        name="transfer-vault"
                        checked={vaultChoice === 'skip'}
                        onChange={() => setVaultChoice('skip')}
                      />
                      <span>
                        只导入配置，不动本机密码
                        <span className="block text-[11px] text-muted">
                          本机已有密码保持不变；备份里的密码不会导入
                        </span>
                      </span>
                    </label>
                    <label className="mt-1 flex items-start gap-2">
                      <input
                        type="radio"
                        name="transfer-vault"
                        checked={vaultChoice === 'merge'}
                        disabled={!preview.vault.canMerge}
                        onChange={() => setVaultChoice('merge')}
                      />
                      <span>
                        合并双方凭证
                        <span className="block text-[11px] text-muted">
                          需要先验证来源主密码与本机一致
                        </span>
                      </span>
                    </label>
                    <label className="mt-1 flex items-start gap-2">
                      <input
                        type="radio"
                        name="transfer-vault"
                        checked={vaultChoice === 'replace'}
                        onChange={() => setVaultChoice('replace')}
                      />
                      <span>
                        清空本机保险库后导入
                        <span className="block text-[11px] text-muted">
                          本机已保存的密码会永久丢失，执行前还会二次确认
                        </span>
                      </span>
                    </label>

                    <div className="mt-2 flex items-end gap-2">
                      <Field label="来源主密码" htmlFor="transfer-source-password">
                        <input
                          id="transfer-source-password"
                          className={inputClass}
                          type="password"
                          autoComplete="off"
                          value={sourceMasterPassword}
                          onChange={(event) => setSourceMasterPassword(event.target.value)}
                        />
                      </Field>
                      <Button disabled={busy} onClick={() => void handleVerifyPassword()}>
                        验证来源主密码
                      </Button>
                    </div>
                    {preview.vault.passwordVerified === false ? (
                      <p className="mt-1 text-[11px] text-danger">来源主密码无法解开备份凭证。</p>
                    ) : null}
                    {preview.vault.sameAsTarget === false ? (
                      <p className="mt-1 text-[11px] text-danger">
                        来源主密码与本机不同，不能合并凭证；请选择「只导入配置」或「清空本机保险库后导入」。
                      </p>
                    ) : null}
                    {preview.vault.sameAsTarget === true ? (
                      <p className="mt-1 text-[11px] text-muted">来源主密码与本机一致，可以合并凭证。</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <p className="rounded-oa border border-border bg-bg p-2 text-[11px] text-muted">
                该备份不含凭证，导入后账号会保留，但需要重新设置密码。
              </p>
            )}

            {preview.warnings.length > 0 ? (
              <ul className="list-disc pl-5 text-[11px] text-muted">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={handleImport} data-testid="transfer-import-confirm">
                确认导入
              </Button>
              {importMessage ? <span className="text-[12px] text-muted">{importMessage}</span> : null}
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="mt-3 rounded-oa border border-border bg-bg p-2 text-[12px]" data-testid="transfer-result">
            <p className="font-medium">导入结果</p>
            <p className="mt-1 text-[11px] text-muted">
              新增：系统 {result.added.systems} / 账号 {result.added.accounts} / 分组{' '}
              {result.added.groups}
            </p>
            <p className="text-[11px] text-muted">
              覆盖：系统 {result.overwritten.systems} / 账号 {result.overwritten.accounts} / 分组{' '}
              {result.overwritten.groups}
            </p>
            <p className="text-[11px] text-muted">
              保留双方：系统 {result.keptBoth.systems} / 账号 {result.keptBoth.accounts} / 分组{' '}
              {result.keptBoth.groups}
            </p>
            <p className="text-[11px] text-muted">
              凭证：{result.credentialsImported ? '已导入' : '未导入'} · 保险库：
              {VAULT_ACTION_LABELS[result.vaultAction]} · 当前默认系统：
              {result.activeSystemId ?? '未设置'}
            </p>
            {result.renamed.length > 0 ? (
              <p className="mt-1 text-[11px] text-muted">
                已重命名：{result.renamed.map((item) => `${item.from} → ${item.to}`).join('；')}
              </p>
            ) : null}
            {result.warnings.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-[11px] text-danger">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmReplaceOpen}
        title="确认清空本机保险库？"
        confirmLabel="清空并导入"
        confirmVariant="danger"
        onClose={() => setConfirmReplaceOpen(false)}
        onConfirm={() => void executeImport(true)}
      >
        <p>
          导入后会采用备份中的密码体系，本机保险库已保存的所有账号密码将永久丢失，且无法恢复。账号与系统配置仍会合并。
        </p>
        <p className="mt-2">如果你不确定，请取消并改为「只导入配置」。</p>
      </Modal>
    </section>
  );
}
