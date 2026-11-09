import { FlowError } from '../shared/types/errors';
import { readMeta, writeMeta } from './repo';

export const SUPPORTED_SCHEMA_VERSION = 1;

/** 读取 meta 并保证 schema 版本可用。阶段一只有 v1，迁移链为空。 */
export async function ensureSchema(): Promise<void> {
  const meta = await readMeta();
  const now = Date.now();

  if (!meta) {
    await writeMeta({ schemaVersion: SUPPORTED_SCHEMA_VERSION, installedAt: now, updatedAt: now });
    return;
  }

  if (meta.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    throw new FlowError('E_INTERNAL', {
      reason: 'schema-too-new',
      elapsedMs: meta.schemaVersion,
    });
  }

  if (meta.schemaVersion < SUPPORTED_SCHEMA_VERSION) {
    await writeMeta({ ...meta, schemaVersion: SUPPORTED_SCHEMA_VERSION, updatedAt: now });
  }
}
