export type ContractShape = string | string[] | Record<string, unknown>;

export interface OutputContract {
  readonly [field: string]: ContractShape;
}
