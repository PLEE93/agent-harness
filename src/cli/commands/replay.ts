import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createSessionRecord } from "../../core/ledger/session";

interface ReplayOptions {
  readonly phase?: string;
  readonly fromFailure?: boolean;
}

export function registerReplayCommand(program: Command): void {
  program
    .command("replay")
    .argument("<session-id>", "Session identifier to replay")
    .option("--phase <phase>", "Only replay one phase")
    .option("--from-failure", "Start at the failed phase when the ledger identifies one")
    .description("Reconstruct a run from the local session ledger")
    .action(async (sessionId: string, options: ReplayOptions) => {
      try {
        console.log(await replaySession(sessionId, process.cwd(), options));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export async function replaySession(sessionId: string, workspaceRoot: string, options: ReplayOptions = {}): Promise<string> {
  const session = createSessionRecord(sessionId, workspaceRoot);
  const [plan, state, verdict] = await Promise.all([
    readJson<Record<string, unknown>>(session.paths.plan),
    readJson<Record<string, unknown>>(session.paths.state),
    readJson<Record<string, unknown>>(session.paths.verdict),
  ]);
  const phases = Array.isArray(plan.phases) ? plan.phases.filter(isPhaseRecord) : [];
  const selectedPhase = options.phase ?? (options.fromFailure ? findFailurePhase(phases, state) : undefined);
  const replayPhases = selectedPhase === undefined ? phases : phases.filter((phase) => phase.name === selectedPhase);

  const lines = [
    `Session: ${sessionId}`,
    `Goal: ${String(plan.goal ?? "")}`,
    `Mode: ${String(plan.mode ?? "")}`,
    `State: ${String(state.status ?? "")}`,
    `Execution status: ${String(verdict.execution_status ?? verdict.status ?? "")}`,
    `Verification status: ${String(verdict.verification_status ?? "unknown")}`,
    `Final status: ${String(verdict.final_status ?? verdict.status ?? "")}`,
    "",
  ];

  for (const phase of replayPhases) {
    const traceRoot = path.join(session.paths.traces, phase.name);
    lines.push(`## Phase: ${phase.name}`);
    lines.push(`Status: ${phase.status}`);
    lines.push(await readOptional(path.join(traceRoot, "adapter_invocation.json"), "Adapter invocation"));
    lines.push(await readOptional(path.join(traceRoot, "prompt.txt"), "Prompt"));
    lines.push(await readOptional(path.join(traceRoot, "handoff.json"), "Handoff"));
    lines.push(await readOptional(path.join(traceRoot, "parsed_output.json"), "Parsed output"));
    lines.push(await readOptional(path.join(traceRoot, "validation.json"), "Shape validation"));
    lines.push(await readOptional(path.join(traceRoot, "semantic_validation.json"), "Semantic validation"));
    lines.push(await readOptional(path.join(traceRoot, "timing.json"), "Timing"));
    lines.push(await readOptional(path.join(traceRoot, "raw_transcript.jsonl"), "Raw transcript"));
    lines.push("");
  }

  lines.push(await readOptional(session.paths.verdict, "Verdict"));
  return lines.join("\n");
}

function findFailurePhase(phases: Array<{ name: string; status: string }>, state: Record<string, unknown>): string | undefined {
  return phases.find((phase) => phase.status === "failed" || phase.status === "blocked")?.name
    ?? (typeof state.current_phase === "string" ? state.current_phase : undefined);
}

async function readOptional(filePath: string, label: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return [`### ${label}`, raw.trimEnd()].join("\n");
  } catch {
    return `### ${label}\n<missing>`;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function isPhaseRecord(value: unknown): value is { name: string; status: string } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { status?: unknown }).status === "string";
}
