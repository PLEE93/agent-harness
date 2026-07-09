import type { Adapter, ExecuteResult, PermissionMode } from "../../adapters/base";
import type { WorkflowPhase } from "../ledger/plan";

export interface PhaseRunnerParams {
  readonly adapter: Adapter;
  readonly phase: WorkflowPhase;
  readonly prompt: string;
  readonly sessionId: string;
  readonly model?: string;
  readonly handoff?: object;
  readonly workingDir?: string;
  readonly permissionMode?: PermissionMode;
}

export async function runPhase(params: PhaseRunnerParams): Promise<ExecuteResult> {
  return params.adapter.execute({
    prompt: params.prompt,
    handoff: params.handoff,
    model: params.model,
    max_turns: params.phase.max_turns,
    max_tool_calls: params.phase.max_tool_calls,
    working_dir: params.workingDir,
    permissionMode: params.permissionMode,
    session_id: params.sessionId,
    phase_name: params.phase.name,
  });
}
