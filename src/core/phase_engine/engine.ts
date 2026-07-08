import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Adapter, ExecuteResult } from "../../adapters/base";
import { appendEvent } from "../ledger/events";
import {
  createPlanFromWorkflow,
  type PlanFile,
  type WorkflowDefinition,
  type WorkflowPhase,
  updatePhaseStatus,
  writePlan,
} from "../ledger/plan";
import { createInitialState, type StateFile, updateState, writeState } from "../ledger/state";
import { createSession, type SessionRecord, writeOutput, writeTextFile } from "../ledger/session";
import { createVerdict, type VerdictFile, type VerdictStatus, writeVerdict } from "../ledger/verdict";
import { resolveModelSeat } from "./cognition";
import { validatePhaseOutput } from "./output_validator";
import { buildHandoffPacket, type HandoffPacket, writeHandoffPacket } from "./prior_output_injector";
import { runPhase } from "./phase_runner";

export interface PhaseEngineOptions {
  readonly sessionId: string;
  readonly mode: string;
  readonly goal: string;
  readonly workspaceRoot?: string;
  readonly workflowPath?: string;
  readonly primaryModel?: string;
  readonly modelAliases?: Record<string, string>;
  readonly adapter?: Adapter;
  readonly adapters?: Record<string, Adapter>;
  readonly resolveAdapter?: (phase: WorkflowPhase) => Adapter;
}

export interface PhaseEngineResult {
  readonly status: "complete" | "blocked" | "failed";
  readonly sessionId: string;
  readonly verdict: VerdictFile;
}

interface PhaseFailure {
  readonly status: Exclude<VerdictStatus, "complete">;
  readonly phaseName: string;
  readonly error: string;
}

export class PhaseEngine {
  public constructor(private readonly options: PhaseEngineOptions) {}

  public get sessionId(): string {
    return this.options.sessionId;
  }

  public async run(): Promise<PhaseEngineResult> {
    const workspaceRoot = this.options.workspaceRoot ?? process.cwd();
    const workflow = await loadWorkflow(this.resolveWorkflowPath(workspaceRoot));
    if (workflow.mode !== this.options.mode) {
      throw new Error(`workflow mode '${workflow.mode}' does not match requested mode '${this.options.mode}'`);
    }

    const plan = createPlanFromWorkflow({
      sessionId: this.options.sessionId,
      goal: this.options.goal,
      primaryModel: this.options.primaryModel ?? "caller",
      workflow,
    });
    const initialState = createInitialState(plan);
    const session = await createSession({
      sessionId: this.options.sessionId,
      workspaceRoot,
      plan,
      state: initialState,
      summary: "",
    });

    await appendEvent(session.paths.events, {
      level: "info",
      type: "run_started",
      data: { session_id: plan.session_id, mode: plan.mode, goal: plan.goal },
    });

    return this.runPhases(session, plan, initialState, workspaceRoot);
  }

  private async runPhases(
    session: SessionRecord,
    initialPlan: PlanFile,
    initialState: StateFile,
    workspaceRoot: string,
  ): Promise<PhaseEngineResult> {
    let plan = initialPlan;
    let state = initialState;
    const phasesCompleted: string[] = [];
    const artifacts = new Set<string>();

    for (let index = 0; index < plan.phases.length; index += 1) {
      const phase = plan.phases[index];
      state = updateState(state, {
        current_phase: phase.name,
        phase_index: index,
        status: "running",
        last_error: null,
      });
      plan = updatePhaseStatus(plan, phase.name, "running");
      await writeState(session.paths.state, state);
      await writePlan(session.paths.plan, plan);
      await appendEvent(session.paths.events, {
        level: "info",
        type: "phase_started",
        data: { phase: phase.name, index, model_seat: phase.model_seat },
      });

      const handoff = await this.prepareHandoff(session, plan, state, phase);
      const adapter = this.selectAdapter(phase);
      const model = resolveModelSeat(phase.model_seat, this.options.primaryModel ?? "caller", this.options.modelAliases).resolved;
      const result = await runPhase({
        adapter,
        phase,
        prompt: buildPhasePrompt(plan, phase, handoff),
        handoff,
        model,
        sessionId: session.sessionId,
        workingDir: workspaceRoot,
      });

      await appendEvent(session.paths.events, {
        level: result.status === "complete" ? "info" : "error",
        type: "phase_adapter_result",
        data: {
          phase: phase.name,
          adapter: adapter.name,
          status: result.status,
          error: result.error ?? null,
          raw_transcript_present: result.raw_transcript !== undefined,
        },
      });

      if (result.status !== "complete") {
        const failure = await this.commitFailure(session, plan, state, phase, result);
        return this.finish(session, plan, failure.status, phasesCompleted, Array.from(artifacts), failure.error);
      }

      const validation = validatePhaseOutput(phase.output_contract, result.output);
      if (!validation.valid) {
        const error = `phase '${phase.name}' output failed contract: ${validation.failures.join("; ")}`;
        state = updateState(state, {
          status: "failed",
          failure_count: state.failure_count + 1,
          last_error: error,
        });
        plan = updatePhaseStatus(plan, phase.name, "failed");
        await writeState(session.paths.state, state);
        await writePlan(session.paths.plan, plan);
        await appendEvent(session.paths.events, {
          level: "error",
          type: "phase_validation_failed",
          data: { phase: phase.name, failures: validation.failures },
        });
        return this.finish(session, plan, "failed", phasesCompleted, Array.from(artifacts), error);
      }

      const outputPath = await writeOutput(session, phase.name, result.output);
      collectArtifacts(result, artifacts);
      phasesCompleted.push(phase.name);
      state = updateState(state, {
        status: "running",
        last_committed_output: phase.name,
        open_questions: extractStringArray(result.output, "open_questions"),
        last_error: null,
      });
      plan = updatePhaseStatus(plan, phase.name, "complete");
      await writeState(session.paths.state, state);
      await writePlan(session.paths.plan, plan);
      await appendEvent(session.paths.events, {
        level: "info",
        type: "phase_output_committed",
        data: { phase: phase.name, output_path: outputPath },
      });
    }

    state = updateState(state, {
      status: "complete",
      current_phase: plan.phases[plan.phases.length - 1]?.name ?? "",
      phase_index: Math.max(plan.phases.length - 1, 0),
      last_error: null,
    });
    await writeState(session.paths.state, state);
    await appendEvent(session.paths.events, {
      level: "info",
      type: "run_completed",
      data: { phases_completed: phasesCompleted },
    });
    return this.finish(session, plan, "complete", phasesCompleted, Array.from(artifacts), "completed all phases");
  }

  private async prepareHandoff(
    session: SessionRecord,
    plan: PlanFile,
    state: StateFile,
    phase: WorkflowPhase,
  ): Promise<HandoffPacket | object | undefined> {
    if (phase.handoff_in === undefined) {
      return undefined;
    }

    const sources = Array.isArray(phase.handoff_in) ? phase.handoff_in : [phase.handoff_in];
    const packets = [];
    for (const source of sources) {
      const packet = await buildHandoffPacket({
        session,
        plan,
        state,
        fromPhase: source,
        toPhase: phase.name,
      });
      const handoffPath = await writeHandoffPacket(session, packet);
      await appendEvent(session.paths.events, {
        level: "info",
        type: "handoff_written",
        data: { from_phase: source, to_phase: phase.name, handoff_path: handoffPath },
      });
      packets.push(packet);
    }

    return packets.length === 1 ? packets[0] : { packets };
  }

  private async commitFailure(
    session: SessionRecord,
    plan: PlanFile,
    state: StateFile,
    phase: WorkflowPhase,
    result: ExecuteResult,
  ): Promise<PhaseFailure> {
    const status: Exclude<VerdictStatus, "complete"> = result.status === "blocked" ? "blocked" : "failed";
    const error = result.error ?? `phase '${phase.name}' returned status '${result.status}'`;
    const nextState = updateState(state, {
      status,
      failure_count: state.failure_count + 1,
      last_error: error,
      open_questions: extractStringArray(result.output, "open_questions"),
    });
    await writeState(session.paths.state, nextState);
    await writePlan(session.paths.plan, updatePhaseStatus(plan, phase.name, status));
    await appendEvent(session.paths.events, {
      level: "error",
      type: "phase_failed",
      data: { phase: phase.name, status, error },
    });
    return { status, phaseName: phase.name, error };
  }

  private async finish(
    session: SessionRecord,
    plan: PlanFile,
    status: VerdictStatus,
    phasesCompleted: string[],
    artifacts: string[],
    summaryDetail: string,
  ): Promise<PhaseEngineResult> {
    const summary = buildSummary(plan, status, phasesCompleted, summaryDetail);
    const verdict = createVerdict({
      plan,
      status,
      phasesCompleted,
      artifacts,
      summary,
    });
    await writeVerdict(session.paths.verdict, verdict);
    await writeTextFile(session.paths.summary, `${summary}\n`);
    await appendEvent(session.paths.events, {
      level: status === "complete" ? "info" : "error",
      type: "verdict_written",
      data: { status, phases_completed: phasesCompleted, artifacts },
    });
    return { status, sessionId: session.sessionId, verdict };
  }

  private selectAdapter(phase: WorkflowPhase): Adapter {
    if (this.options.resolveAdapter !== undefined) {
      return this.options.resolveAdapter(phase);
    }
    const adapter = this.options.adapters?.[phase.model_seat]
      ?? this.options.adapters?.caller
      ?? this.options.adapter;
    if (adapter === undefined) {
      throw new Error(`no adapter configured for phase '${phase.name}' with model seat '${phase.model_seat}'`);
    }
    return adapter;
  }

  private resolveWorkflowPath(workspaceRoot: string): string {
    return this.options.workflowPath ?? path.join(workspaceRoot, "src", "modes", `${this.options.mode}.yaml`);
  }
}

export async function loadWorkflow(workflowPath: string): Promise<WorkflowDefinition> {
  const raw = await fs.readFile(workflowPath, "utf8");
  const loaded = yaml.load(raw);
  if (!isWorkflowDefinition(loaded)) {
    throw new Error(`workflow file '${workflowPath}' must contain mode and phases[]`);
  }
  return loaded;
}

export function buildPhasePrompt(plan: PlanFile, phase: WorkflowPhase, handoff: object | undefined): string {
  const lines = [
    `Goal: ${plan.goal}`,
    `Mode: ${plan.mode}`,
    `Phase: ${phase.name}`,
    `Type: ${phase.type}`,
    `Output contract: ${JSON.stringify(phase.output_contract ?? {}, null, 2)}`,
  ];
  if (phase.objective !== undefined) {
    lines.push(`Objective: ${phase.objective}`);
  }
  if (handoff !== undefined) {
    lines.push(`Handoff packet: ${JSON.stringify(handoff, null, 2)}`);
  }
  return `${lines.join("\n")}\n`;
}

function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (!isRecord(value) || typeof value.mode !== "string" || !Array.isArray(value.phases)) {
    return false;
  }
  return value.phases.every((phase) => isRecord(phase) && typeof phase.name === "string" && typeof phase.type === "string");
}

function collectArtifacts(result: ExecuteResult, artifacts: Set<string>): void {
  for (const artifact of result.artifacts ?? []) {
    artifacts.add(artifact);
  }
  for (const artifact of extractStringArray(result.output, "artifacts")) {
    artifacts.add(artifact);
  }
}

function extractStringArray(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }
  return value[key].filter((item): item is string => typeof item === "string");
}

function buildSummary(plan: PlanFile, status: VerdictStatus, phasesCompleted: string[], detail: string): string {
  return [
    `# cc-harness session ${plan.session_id}`,
    "",
    `Goal: ${plan.goal}`,
    `Mode: ${plan.mode}`,
    `Status: ${status}`,
    `Phases completed: ${phasesCompleted.join(", ") || "none"}`,
    `Result: ${detail}`,
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
