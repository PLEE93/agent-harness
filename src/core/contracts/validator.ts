import type { OutputContract } from "./types";
import { validatePhaseOutput } from "../phase_engine/output_validator";

export interface ContractValidationResult {
  readonly valid: boolean;
  readonly failures: string[];
}

export function validateContract(contract: OutputContract, value: unknown): ContractValidationResult {
  return validatePhaseOutput(contract, value);
}
