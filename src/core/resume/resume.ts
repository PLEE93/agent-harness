import { promises as fs } from "node:fs";
import type { Adapter, PermissionMode } from "../../adapters/base";
import type { HarnessConfig } from "../config/loader";
import { readPlan } from "../ledger/plan";
import { readState, type SessionStatus } from "../ledger/state";
import { createSessionRecord } from "../ledger/session";
import { PhaseEngine, type PhaseEngineResult } from "../phase_engine/engine";

export interface ResumeRequest {
  readonly sessionId: string;
  readonly workspaceRoot?: string;
  readonly adapter: Adapter;
  readonly adapters?: Record<string, Adapter>;
  readonly config?: HarnessConfig;
  readonly modelAliases?: Record<string, string>;
  readonly permissionMode?: PermissionMode;
  readonly resolveWorkflowPath?: (mode: string) => Promise<string>;
}

export interface ResumeSkippedResult {
  readonly resumed: false;
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly message: string;
}

export interface ResumeCompletedResult {
  readonly resumed: true;
  readonly sessionId: string;
  readonly result: PhaseEngineResult;
}

export type ResumeSessionResult = ResumeSkippedResult | ResumeCompletedResult;

export async function resumeSession(request: ResumeRequest): Promise<ResumeSessionResult> {
  const workspaceRoot = request.workspaceRoot ?? process.cwd();
  const session = createSessionRecord(request.sessionId, workspaceRoot);
  await ensureSessionExists(session.paths.root, request.sessionId);

  const [plan, state] = await Promise.all([
    readPlan(session.paths.plan),
    readState(session.paths.state),
  ]);

  if (isTerminalStatus(state.status)) {
    return {
      resumed: false,
      sessionId: request.sessionId,
      status: state.status,
      message: `Session ${request.sessionId} is ${state.status} and cannot be resumed.`,
    };
  }

  if (state.status !== "running" && state.status !== "pending") {
    throw new Error(`session '${request.sessionId}' has unsupported status '${state.status}'`);
  }

  const workflowPath = request.resolveWorkflowPath === undefined
    ? undefined
    : await request.resolveWorkflowPath(plan.mode);

  const engine = new PhaseEngine({
    sessionId: request.sessionId,
    mode: plan.mode,
    goal: plan.goal,
    workspaceRoot,
    workflowPath,
    primaryModel: plan.primary_model,
    modelAliases: request.modelAliases,
    permissionMode: request.permissionMode ?? "ask",
    startPhaseIndex: state.phase_index,
    adapter: request.adapter,
    adapters: request.adapters,
    routing: plan.routing,
  });

  return {
    resumed: true,
    sessionId: request.sessionId,
    result: await engine.resume(plan, state),
  };
}

function isTerminalStatus(status: SessionStatus): status is "blocked" | "failed" | "complete" {
  return status === "blocked" || status === "failed" || status === "complete";
}

async function ensureSessionExists(sessionRoot: string, sessionId: string): Promise<void> {
  try {
    await fs.access(sessionRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`session '${sessionId}' not found at .cc-harness/sessions/${sessionId}`);
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
