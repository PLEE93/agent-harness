import type { PlanFile } from "./plan";
import { readJsonFile, writeJsonFile } from "./session";

export type VerdictStatus = "complete" | "blocked" | "failed";

export interface VerdictFile {
  readonly session_id: string;
  readonly goal: string;
  readonly mode: string;
  readonly status: VerdictStatus;
  readonly phases_completed: string[];
  readonly artifacts: string[];
  readonly summary: string;
  readonly completed_at: string;
}

export interface CreateVerdictParams {
  readonly plan: PlanFile;
  readonly status: VerdictStatus;
  readonly phasesCompleted: string[];
  readonly artifacts: string[];
  readonly summary: string;
  readonly completedAt?: string;
}

export function createVerdict(params: CreateVerdictParams): VerdictFile {
  return {
    session_id: params.plan.session_id,
    goal: params.plan.goal,
    mode: params.plan.mode,
    status: params.status,
    phases_completed: params.phasesCompleted,
    artifacts: params.artifacts,
    summary: params.summary,
    completed_at: params.completedAt ?? new Date().toISOString(),
  };
}

export async function readVerdict(verdictPath: string): Promise<VerdictFile> {
  return readJsonFile<VerdictFile>(verdictPath);
}

export async function writeVerdict(verdictPath: string, verdict: VerdictFile): Promise<void> {
  await writeJsonFile(verdictPath, verdict);
}
