declare const idBrand: unique symbol;

export type BrandedId<K extends string> = string & { readonly [idBrand]: K };

export type AccountId = BrandedId<'Account'>;
export type SystemId = BrandedId<'System'>;
export type GroupId = BrandedId<'Group'>;
export type RunId = BrandedId<'Run'>;

const PREFIX = {
  Account: 'acc',
  System: 'sys',
  Group: 'grp',
  Run: 'run',
} as const;

function randomHex(byteCount: number): string {
  const buffer = new Uint8Array(byteCount);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newId<K extends keyof typeof PREFIX>(kind: K): BrandedId<K> {
  return `${PREFIX[kind]}_${randomHex(6)}` as BrandedId<K>;
}

export const newAccountId = (): AccountId => newId('Account');
export const newSystemId = (): SystemId => newId('System');
export const newGroupId = (): GroupId => newId('Group');
export const newRunId = (): RunId => newId('Run');
