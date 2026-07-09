import type { PlanFile } from "./plan";
import { readJsonFile, writeJsonFile } from "./session";

export type VerdictStatus = "complete" | "blocked" | "failed";
export type ExecutionStatus = "complete" | "blocked" | "failed";
export type VerificationStatus = "pass" | "fail" | "not_run" | "unknown";
export type FinalStatus =
  | "success"
  | "failed_verification"
  | "blocked"
  | "failed_contract"
  | "failed_adapter"
  | "failed_artifact"
  | "failed_loop_limit"
  | "failed_exception";

export interface ArtifactManifestEntry {
  readonly path: string;
  readonly exists: boolean;
  readonly inside_workspace: boolean;
  readonly size_bytes?: number;
  readonly sha256?: string;
  readonly error?: string;
}

export interface VerdictFile {
  readonly session_id: string;
  readonly goal: string;
  readonly mode: string;
  readonly execution_status: ExecutionStatus;
  readonly verification_status: VerificationStatus;
  readonly final_status: FinalStatus;
  readonly status: VerdictStatus;
  readonly phases_completed: string[];
  readonly artifacts: string[];
  readonly artifact_manifest: ArtifactManifestEntry[];
  readonly summary: string;
  readonly completed_at: string;
}

export interface CreateVerdictParams {
  readonly plan: PlanFile;
  readonly status: VerdictStatus;
  readonly executionStatus?: ExecutionStatus;
  readonly verificationStatus?: VerificationStatus;
  readonly finalStatus?: FinalStatus;
  readonly phasesCompleted: string[];
  readonly artifacts: string[];
  readonly artifactManifest?: ArtifactManifestEntry[];
  readonly summary: string;
  readonly completedAt?: string;
}

export function createVerdict(params: CreateVerdictParams): VerdictFile {
  return {
    session_id: params.plan.session_id,
    goal: params.plan.goal,
    mode: params.plan.mode,
    execution_status: params.executionStatus ?? params.status,
    verification_status: params.verificationStatus ?? "unknown",
    final_status: params.finalStatus ?? legacyFinalStatus(params.status),
    status: params.status,
    phases_completed: params.phasesCompleted,
    artifacts: params.artifacts,
    artifact_manifest: params.artifactManifest ?? [],
    summary: params.summary,
    completed_at: params.completedAt ?? new Date().toISOString(),
  };
}

function legacyFinalStatus(status: VerdictStatus): FinalStatus {
  if (status === "complete") {
    return "success";
  }
  if (status === "blocked") {
    return "blocked";
  }
  return "failed_exception";
}

export async function readVerdict(verdictPath: string): Promise<VerdictFile> {
  return readJsonFile<VerdictFile>(verdictPath);
}

export async function writeVerdict(verdictPath: string, verdict: VerdictFile): Promise<void> {
  await writeJsonFile(verdictPath, verdict);
}
