export type BrandedId<Name extends string> = string & { readonly __brand: Name };
export type SessionId = BrandedId<'SessionId'>;
export type AgentId = BrandedId<'AgentId'>;
export type TaskId = BrandedId<'TaskId'>;
export type MessageId = BrandedId<'MessageId'>;

export function asId<Name extends string>(value: string, name: Name): BrandedId<Name> {
  if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(value)) throw new Error(`Invalid ${name}`);
  return value as BrandedId<Name>;
}
