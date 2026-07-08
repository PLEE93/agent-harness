import type { PlanFile } from "./plan";
import { readJsonFile, writeJsonFile } from "./session";

export type SessionStatus = "pending" | "running" | "blocked" | "failed" | "complete";

export interface StateFile {
  readonly session_id: string;
  readonly current_phase: string;
  readonly phase_index: number;
  readonly status: SessionStatus;
  readonly last_committed_output: string | null;
  readonly open_questions: string[];
  readonly failure_count: number;
  readonly last_error: string | null;
}

export function createInitialState(plan: PlanFile): StateFile {
  return {
    session_id: plan.session_id,
    current_phase: plan.phases[0]?.name ?? "",
    phase_index: 0,
    status: "pending",
    last_committed_output: null,
    open_questions: [],
    failure_count: 0,
    last_error: null,
  };
}

export function updateState(state: StateFile, patch: Partial<StateFile>): StateFile {
  return {
    ...state,
    ...patch,
  };
}

export async function readState(statePath: string): Promise<StateFile> {
  return readJsonFile<StateFile>(statePath);
}

export async function writeState(statePath: string, state: StateFile): Promise<void> {
  await writeJsonFile(statePath, state);
}
