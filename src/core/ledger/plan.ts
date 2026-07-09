import type { OutputContract } from "../contracts/types";
import { readJsonFile, writeJsonFile } from "./session";

export type PhaseStatus = "pending" | "running" | "complete" | "blocked" | "failed";

export interface SemanticCheck {
  readonly phase?: string;
  readonly field: string;
  readonly pass_value: unknown;
  readonly fail_status?: string;
}

export interface LoopUntilCondition {
  readonly field: string;
  readonly value: unknown;
}

export interface WorkflowPhase {
  readonly name: string;
  readonly type: string;
  readonly objective?: string;
  readonly model_seat: string;
  readonly output_contract?: OutputContract;
  readonly semantic_checks?: SemanticCheck[];
  readonly max_tool_calls?: number;
  readonly max_turns?: number;
  readonly handoff_in?: string | string[];
  readonly cognition?: string;
  readonly loop?: boolean;
  readonly loop_until?: LoopUntilCondition;
  readonly max_loop_iterations?: number;
  readonly status: PhaseStatus;
}

export interface SeatRoute {
  readonly adapter: string;
  readonly model: string;
}

export interface PlanRouting {
  readonly permission_mode?: string;
  readonly seats: Record<string, SeatRoute>;
}

export interface PlanFile {
  readonly session_id: string;
  readonly goal: string;
  readonly mode: string;
  readonly primary_model: string;
  readonly participants: string[];
  readonly routing?: PlanRouting;
  readonly phases: WorkflowPhase[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkflowDefinitionPhase {
  readonly name: string;
  readonly type: string;
  readonly objective?: string;
  readonly model?: string;
  readonly max_tool_calls?: number;
  readonly max_turns?: number;
  readonly handoff_in?: string | string[];
  readonly cognition?: string;
  readonly loop?: boolean;
  readonly loop_until?: LoopUntilCondition;
  readonly max_loop_iterations?: number;
  readonly output_contract?: OutputContract;
  readonly semantic_checks?: SemanticCheck[];
}

export interface WorkflowDefinition {
  readonly mode: string;
  readonly description?: string;
  readonly phases: WorkflowDefinitionPhase[];
}

export interface CreatePlanParams {
  readonly sessionId: string;
  readonly goal: string;
  readonly primaryModel: string;
  readonly workflow: WorkflowDefinition;
  readonly routing?: PlanRouting;
  readonly createdAt?: string;
}

export function createPlanFromWorkflow(params: CreatePlanParams): PlanFile {
  const now = params.createdAt ?? new Date().toISOString();
  const phases = params.workflow.phases.map((phase): WorkflowPhase => ({
    name: phase.name,
    type: phase.type,
    objective: phase.objective,
    model_seat: phase.model ?? "caller",
    output_contract: phase.output_contract,
    semantic_checks: phase.semantic_checks,
    max_tool_calls: phase.max_tool_calls,
    max_turns: phase.max_turns,
    handoff_in: phase.handoff_in,
    cognition: phase.cognition,
    loop: phase.loop,
    loop_until: phase.loop_until,
    max_loop_iterations: phase.max_loop_iterations,
    status: "pending",
  }));

  return {
    session_id: params.sessionId,
    goal: params.goal,
    mode: params.workflow.mode,
    primary_model: params.primaryModel,
    participants: Array.from(new Set(phases.map((phase) => phase.model_seat))),
    routing: params.routing,
    phases,
    created_at: now,
    updated_at: now,
  };
}

export function updatePhaseStatus(plan: PlanFile, phaseName: string, status: PhaseStatus): PlanFile {
  return {
    ...plan,
    phases: plan.phases.map((phase) => (phase.name === phaseName ? { ...phase, status } : phase)),
    updated_at: new Date().toISOString(),
  };
}

export async function readPlan(planPath: string): Promise<PlanFile> {
  return readJsonFile<PlanFile>(planPath);
}

export async function writePlan(planPath: string, plan: PlanFile): Promise<void> {
  await writeJsonFile(planPath, plan);
}
