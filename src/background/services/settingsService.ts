import { setDebugLogging } from '../../shared/log';
import type { Settings } from '../../shared/types/settings';
import { readSettings, writeSettings } from '../../storage/repo';

let lastActivityAt = Date.now();

export function markUserActivity(): void {
  lastActivityAt = Date.now();
}

export function getLastActivityAt(): number {
  return lastActivityAt;
}

export async function getSettings(): Promise<Settings> {
  markUserActivity();
  const settings = await readSettings();
  setDebugLogging(settings.debugLogging);
  return settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  markUserActivity();
  const next = await writeSettings(patch);
  setDebugLogging(next.debugLogging);
  return next;
}

export async function applyDebugFlag(): Promise<void> {
  const settings = await readSettings();
  setDebugLogging(settings.debugLogging);
}
