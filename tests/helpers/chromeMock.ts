/** chrome.storage.local / session 的内存假实现，仅供单测使用。 */

export interface ChromeMock {
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  reset: () => void;
  /** 手动触发 storage.onChanged，供内容脚本监听逻辑测试。 */
  emitStorageChange: (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area?: 'local' | 'session',
  ) => void;
}

type StorageGetKeys = string | string[] | Record<string, unknown> | null | undefined;

function clearStore(store: Record<string, unknown>): void {
  for (const key of Object.keys(store)) delete store[key];
}

function createArea(store: Record<string, unknown>) {
  return {
    async get(keys?: StorageGetKeys): Promise<Record<string, unknown>> {
      if (keys === null || keys === undefined) return { ...store };
      if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
      if (Array.isArray(keys)) {
        const output: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in store) output[key] = store[key];
        }
        return output;
      }
      const output: Record<string, unknown> = {};
      for (const [key, fallback] of Object.entries(keys)) {
        output[key] = key in store ? store[key] : fallback;
      }
      return output;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
    async clear(): Promise<void> {
      clearStore(store);
    },
  };
}

export function installChromeMock(): ChromeMock {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  type ChangeListener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string,
  ) => void;
  const listeners = new Set<ChangeListener>();

  const chromeMock = {
    storage: {
      local: createArea(local),
      session: createArea(session),
      onChanged: {
        addListener(listener: ChangeListener): void {
          listeners.add(listener);
        },
        removeListener(listener: ChangeListener): void {
          listeners.delete(listener);
        },
      },
    },
    scripting: {
      async getRegisteredContentScripts(): Promise<unknown[]> {
        return [];
      },
      async registerContentScripts(): Promise<void> {},
      async unregisterContentScripts(): Promise<void> {},
    },
    permissions: {
      async contains(): Promise<boolean> {
        return true;
      },
      async remove(): Promise<boolean> {
        return true;
      },
    },
    tabs: {
      async query(): Promise<unknown[]> {
        return [];
      },
      async sendMessage(): Promise<unknown> {
        throw new Error('no-receiver');
      },
      async update(): Promise<unknown> {
        return {};
      },
      async create(): Promise<unknown> {
        return { id: 1 };
      },
    },
    windows: {
      async update(): Promise<unknown> {
        return {};
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

  return {
    local,
    session,
    reset() {
      clearStore(local);
      clearStore(session);
      listeners.clear();
    },
    emitStorageChange(changes, area = 'local') {
      for (const listener of listeners) listener(changes, area);
    },
  };
}
