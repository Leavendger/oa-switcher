// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createGroup,
  deleteGroup,
  listGroups,
  updateGroup,
} from '../../src/background/services/groupService';
import { FlowError, isFlowError } from '../../src/shared/types/errors';
import type { GroupDraft } from '../../src/shared/types/account';
import { installChromeMock } from '../helpers/chromeMock';

function draft(overrides: Partial<GroupDraft> = {}): GroupDraft {
  return {
    name: '生产',
    color: 'blue',
    sortOrder: 0,
    collapsedByDefault: false,
    ...overrides,
  };
}

async function expectCode(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(isFlowError(error)).toBe(true);
    expect((error as FlowError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('groupService', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('创建与列表', async () => {
    const created = await createGroup(draft());
    const groups = await listGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(created);
  });

  it('名称忽略大小写唯一', async () => {
    await createGroup(draft({ name: 'Production' }));
    await expectCode(createGroup(draft({ name: 'production' })), 'E_VALIDATION');
  });

  it('颜色只接受预置 key；空名称被拒绝', async () => {
    await expectCode(createGroup(draft({ color: '#ff0000' })), 'E_VALIDATION');
    await expectCode(createGroup(draft({ name: '  ' })), 'E_VALIDATION');
  });

  it('更新时排除自身做唯一性校验', async () => {
    const group = await createGroup(draft({ name: 'A' }));
    const updated = await updateGroup(group.id, { name: 'A2', sortOrder: 5 });
    expect(updated.name).toBe('A2');
    expect(updated.sortOrder).toBe(5);

    await createGroup(draft({ name: 'B' }));
    await expectCode(updateGroup(group.id, { name: 'B' }), 'E_VALIDATION');
  });

  it('删除不存在的分组被拒绝', async () => {
    await expectCode(deleteGroup('grp_missing' as never), 'E_VALIDATION');
  });
});
