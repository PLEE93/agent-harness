import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Adapter, ExecuteResult, PermissionMode } from "../../adapters/base";
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
import { createSession, createSessionRecord, type SessionRecord, writeJsonFile, writeOutput, writeTextFile } from "../ledger/session";
import { createVerdict, type VerdictFile, type VerdictStatus, writeVerdict } from "../ledger/verdict";
import { resolveModelSeat } from "./cognition";
import { resolveCognitionPack } from "./cognition_packs";
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
  readonly permissionMode?: PermissionMode;
  readonly startPhaseIndex?: number;
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

  public async resume(plan: PlanFile, state: StateFile): Promise<PhaseEngineResult> {
    const workspaceRoot = this.options.workspaceRoot ?? process.cwd();
    const session = createSessionRecord(this.options.sessionId, workspaceRoot);
    await appendEvent(session.paths.events, {
      level: "info",
      type: "resume_started",
      data: {
        session_id: plan.session_id,
        mode: plan.mode,
        phase_index: this.options.startPhaseIndex ?? state.phase_index,
      },
    });
    return this.runPhases(session, plan, state, workspaceRoot);
  }

  private async runPhases(
    session: SessionRecord,
    initialPlan: PlanFile,
    initialState: StateFile,
    workspaceRoot: string,
  ): Promise<PhaseEngineResult> {
    let plan = initialPlan;
    let state = initialState;
    const startIndex = clampPhaseIndex(this.options.startPhaseIndex ?? 0, plan.phases.length);
    const phasesCompleted = plan.phases
      .slice(0, startIndex)
      .filter((phase) => phase.status === "complete")
      .map((phase) => phase.name);
    const artifacts = new Set<string>();
    const loopCounts = new Map<string, number>();
    const loopOutputs = new Map<string, object[]>();

    for (let index = startIndex; index < plan.phases.length; index += 1) {
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

      const baseHandoff = await this.prepareHandoff(session, plan, state, phase);
      const handoff = appendLoopHandoff(baseHandoff, loopOutputs.get(phase.name));
      const adapter = this.selectAdapter(phase);
      const model = resolveModelSeat(phase.model_seat, this.options.primaryModel ?? "caller", this.options.modelAliases).resolved;
      const prompt = buildPhasePrompt(plan, phase, handoff);
      const traceDir = path.join(session.paths.traces, phase.name);
      await writeTextFile(path.join(traceDir, "prompt.txt"), prompt);
      if (handoff !== undefined) {
        await writeJsonFile(path.join(traceDir, "handoff.json"), handoff);
      }
      await writeJsonFile(path.join(traceDir, "adapter_invocation.json"), {
        adapter: adapter.name,
        model,
        model_seat: phase.model_seat,
        max_turns: phase.max_turns ?? null,
        max_tool_calls: phase.max_tool_calls ?? null,
        permission_mode: this.options.permissionMode ?? "ask",
      });
      const startedAt = Date.now();
      const result = await runPhase({
        adapter,
        phase,
        prompt,
        handoff,
        model,
        sessionId: session.sessionId,
        workingDir: workspaceRoot,
        permissionMode: this.options.permissionMode ?? "ask",
      });
      const endedAt = Date.now();
      await writeJsonFile(path.join(traceDir, "timing.json"), {
        started_at_ms: startedAt,
        ended_at_ms: endedAt,
        duration_ms: endedAt - startedAt,
      });
      await writeJsonFile(path.join(traceDir, "parsed_output.json"), result.output);
      if (result.raw_transcript !== undefined) {
        await writeTextFile(path.join(traceDir, "raw_transcript.jsonl"), `${result.raw_transcript}\n`);
      }

      await appendEvent(session.paths.events, {
        level: result.status === "complete" ? "info" : "error",
        type: "phase_adapter_result",
        data: {
          phase: phase.name,
          adapter: adapter.name,
          status: result.status,
          error: result.error ?? null,
          raw_transcript_present: result.raw_transcript !== undefined,
          trace_path: traceDir,
        },
      });

      if (result.status !== "complete") {
        const failure = await this.commitFailure(session, plan, state, phase, result);
        return this.finish(session, plan, failure.status, phasesCompleted, Array.from(artifacts), failure.error);
      }

      const validation = validatePhaseOutput(phase.output_contract, result.output);
      await writeJsonFile(path.join(traceDir, "validation.json"), validation);
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

      if (phase.loop_until !== undefined) {
        const output = result.output as Record<string, unknown>;
        const fieldValue = output[phase.loop_until.field];
        if (fieldValue !== phase.loop_until.value) {
          const currentLoopCount = loopCounts.get(phase.name) ?? 0;
          const maxLoopIterations = phase.max_loop_iterations ?? 3;
          if (currentLoopCount < maxLoopIterations) {
            loopCounts.set(phase.name, currentLoopCount + 1);
            loopOutputs.set(phase.name, [...(loopOutputs.get(phase.name) ?? []), result.output]);
            await appendEvent(session.paths.events, {
              level: "info",
              type: "phase_loop_retry",
              data: {
                phase: phase.name,
                field: phase.loop_until.field,
                expected: phase.loop_until.value,
                actual: fieldValue,
                iteration: currentLoopCount + 1,
                max_iterations: maxLoopIterations,
              },
            });
            index -= 1;
            continue;
          }

          const error = `phase '${phase.name}' loop_until not satisfied after ${maxLoopIterations} iterations: expected '${phase.loop_until.field}' to equal ${JSON.stringify(phase.loop_until.value)}, got ${JSON.stringify(fieldValue)}`;
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
            type: "phase_loop_limit_reached",
            data: {
              phase: phase.name,
              field: phase.loop_until.field,
              expected: phase.loop_until.value,
              actual: fieldValue,
              max_iterations: maxLoopIterations,
            },
          });
          return this.finish(session, plan, "failed", phasesCompleted, Array.from(artifacts), error);
        }
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
    await appendRunIndex(session, plan, status, phasesCompleted, artifacts, summaryDetail);
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
    `# Phase: ${phase.name}`,
    "",
    `**Role:** You are the ${phase.type} actor for this harness session.`,
    `**Goal:** ${plan.goal}`,
    `**Mode:** ${plan.mode}`,
    `**Your objective:** ${phase.objective ?? phase.name}`,
    "",
  ];

  const cognition = resolveCognitionPack(phase.cognition);
  if (cognition !== undefined) {
    lines.push(`**Cognition pack:** ${cognition.name}`, "```text", cognition.body, "```", "");
  }

  lines.push(
    "**Output contract (return ONLY this JSON, no prose outside the JSON block):**",
    "```json",
    JSON.stringify(phase.output_contract ?? {}, null, 2),
    "```",
    "",
    "**Success criteria:** your output must match every field in the contract above.",
    "**Failure mode to avoid:** returning prose instead of JSON, or JSON with wrong keys.",
    "**When blocked:** return {\"status\": \"blocked\", \"error\": \"<reason>\", \"open_questions\": [\"...\"]}",
    "",
    "**Handoff JSON:** when prior phase data is supplied below, use it as context and still return only the output contract JSON.",
  );

  if (phase.loop_until !== undefined) {
    lines.push(
      "",
      `**Loop condition:** this phase may be repeated until output.${phase.loop_until.field} equals ${JSON.stringify(phase.loop_until.value)}.`,
    );
  }

  if (handoff !== undefined) {
    lines.push("", "**Handoff from prior phases:**");
    lines.push("```json");
    lines.push(JSON.stringify(handoff, null, 2));
    lines.push("```");
  }

  return `${lines.join("\n")}\n`;
}

function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (!isRecord(value) || typeof value.mode !== "string" || !Array.isArray(value.phases)) {
    return false;
  }
  return value.phases.every((phase) => isRecord(phase) && typeof phase.name === "string" && typeof phase.type === "string");
}

function appendLoopHandoff(handoff: object | undefined, previousOutputs: object[] | undefined): object | undefined {
  if (previousOutputs === undefined || previousOutputs.length === 0) {
    return handoff;
  }
  const loopHandoff = { loop_previous_outputs: previousOutputs };
  return handoff === undefined ? loopHandoff : { ...handoff, ...loopHandoff };
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

function clampPhaseIndex(index: number, phaseCount: number): number {
  if (phaseCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), phaseCount);
}


async function appendRunIndex(
  session: SessionRecord,
  plan: PlanFile,
  status: VerdictStatus,
  phasesCompleted: string[],
  artifacts: string[],
  detail: string,
): Promise<void> {
  const indexRoot = path.resolve(session.paths.root, "..", "..", "index");
  const record = {
    session_id: plan.session_id,
    goal: plan.goal,
    mode: plan.mode,
    status,
    phases_completed: phasesCompleted,
    artifacts,
    detail,
    recorded_at: new Date().toISOString(),
  };
  await appendJsonl(path.join(indexRoot, "sessions.jsonl"), record);

  if (status !== "complete") {
    await appendJsonl(path.join(indexRoot, "failures.jsonl"), {
      ...record,
      failure_type: classifyFailure(detail),
    });
  }
}

async function appendJsonl(filePath: string, value: object): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function classifyFailure(detail: string): string {
  if (/contract|missing required key|validation/i.test(detail)) {
    return "contract_violation";
  }
  if (/rate.?limit|quota|too many requests|429/i.test(detail)) {
    return "rate_limited";
  }
  if (/auth|login|credential|api key|unauthorized/i.test(detail)) {
    return "auth_blocked";
  }
  if (/loop_until|loop limit/i.test(detail)) {
    return "loop_limit_reached";
  }
  if (/not found|executable|spawn|adapter/i.test(detail)) {
    return "adapter_failure";
  }
  return "verification_failed";
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
