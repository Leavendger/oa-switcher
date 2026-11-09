import { beforeEach, describe, expect, it } from 'vitest';
import { deleteSystem } from '../../src/background/services/systemService';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';
import type { Account } from '../../src/shared/types/account';
import type { OASystem } from '../../src/shared/types/system';
import { newAccountId, newSystemId } from '../../src/shared/types/ids';
import {
  readAccounts,
  readSettings,
  readSystems,
  writeAccounts,
  writeSettings,
  writeSystems,
} from '../../src/storage/repo';
import { STORAGE_KEYS } from '../../src/storage/keys';
import { installChromeMock, type ChromeMock } from '../helpers/chromeMock';

const ORIGIN = 'https://oa.example.com';
const SYSTEM_ID = newSystemId();

function makeSystem(overrides: Partial<OASystem> = {}): OASystem {
  return {
    id: SYSTEM_ID,
    name: '蓝凌 OA',
    vendor: 'landray',
    enabled: true,
    origins: [ORIGIN],
    loginUrl: `${ORIGIN}/login.jsp`,
    homeUrl: null,
    adapterConfig: {},
    permissionState: 'granted',
    urlSignatures: [],
    originPermissions: { [ORIGIN]: 'granted' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeAccount(systemId = SYSTEM_ID): Account {
  return {
    id: newAccountId(),
    label: '账号',
    username: 'user',
    systemId,
    groupId: null,
    role: null,
    note: null,
    enabled: true,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('systemService.deleteSystem', () => {
  let mock: ChromeMock;

  beforeEach(async () => {
    mock = installChromeMock();
    await writeSystems([makeSystem()]);
    await writeSettings({
      ...DEFAULT_SETTINGS,
      activeSystemId: SYSTEM_ID,
      rememberedSystems: { [`${ORIGIN}/oa/`]: SYSTEM_ID },
    });
    await chrome.storage.local.set({
      [STORAGE_KEYS.floatDismissed]: { [ORIGIN]: true },
      [STORAGE_KEYS.floatPositions]: { [ORIGIN]: { x: 10, y: 20 } },
    });
  });

  it('无账号引用时正常删除，并清理设置、悬浮球偏好与域名权限', async () => {
    const removedOrigins: string[][] = [];
    chrome.permissions.remove = async (permissions: chrome.permissions.Permissions) => {
      removedOrigins.push(permissions.origins ?? []);
      return true;
    };

    const result = await deleteSystem(SYSTEM_ID);

    expect(result).toMatchObject({
      deleted: true,
      deletedAccountCount: 0,
      permissionRemoved: true,
      permissionWarning: null,
      cleanedFloatOrigins: 2,
    });
    expect(await readSystems()).toEqual([]);
    const settings = await readSettings();
    expect(settings.activeSystemId).toBeNull();
    expect(settings.rememberedSystems).toEqual({});
    expect(mock.local[STORAGE_KEYS.floatDismissed]).toEqual({});
    expect(mock.local[STORAGE_KEYS.floatPositions]).toEqual({});
    expect(removedOrigins).toEqual([[`${ORIGIN}/*`]]);
  });

  it('仍有账号引用时拒绝删除，返回账号数量且不产生孤儿', async () => {
    const account = makeAccount();
    await writeAccounts([account]);

    let removeCalled = false;
    chrome.permissions.remove = async () => {
      removeCalled = true;
      return true;
    };

    await expect(deleteSystem(SYSTEM_ID)).rejects.toMatchObject({
      code: 'E_SYSTEM_IN_USE',
      detail: { accountCount: 1 },
    });
    expect(await readSystems()).toHaveLength(1);
    expect(await readAccounts()).toEqual([account]);
    expect(removeCalled).toBe(false);
  });

  it('选择连同账号一起删除时，系统与账号元数据一起移除', async () => {
    await writeAccounts([makeAccount(), makeAccount()]);

    const result = await deleteSystem(SYSTEM_ID, { deleteAccounts: true });

    expect(result.deletedAccountCount).toBe(2);
    expect(await readSystems()).toEqual([]);
    expect(await readAccounts()).toEqual([]);
  });

  it('权限撤销失败不阻塞删除，只返回残留提示', async () => {
    chrome.permissions.remove = async () => {
      throw new Error('permission-api-failed');
    };

    const result = await deleteSystem(SYSTEM_ID);

    expect(result.deleted).toBe(true);
    expect(result.permissionRemoved).toBe(false);
    expect(result.permissionWarning).toBe('permission-may-remain');
    expect(await readSystems()).toEqual([]);
  });

  it('同一 origin 仍被其他系统使用时不撤销权限、不清理悬浮球偏好', async () => {
    const otherId = newSystemId();
    await writeSystems([makeSystem(), makeSystem({ id: otherId, name: '同域系统' })]);
    await chrome.storage.local.set({
      [STORAGE_KEYS.floatDismissed]: { [ORIGIN]: true },
    });

    let removeCalled = false;
    chrome.permissions.remove = async () => {
      removeCalled = true;
      return true;
    };

    const result = await deleteSystem(SYSTEM_ID);

    expect(result.permissionWarning).toBeNull();
    expect(removeCalled).toBe(false);
    expect(mock.local[STORAGE_KEYS.floatDismissed]).toEqual({ [ORIGIN]: true });
  });
});
