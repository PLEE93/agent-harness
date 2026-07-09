import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { readPlan } from "../../core/ledger/plan";
import { readState } from "../../core/ledger/state";
import { createSessionRecord } from "../../core/ledger/session";
import { readVerdict, type VerdictFile } from "../../core/ledger/verdict";

export function registerStateCommand(program: Command): void {
  program
    .command("state")
    .argument("<session-id>", "Session identifier to inspect")
    .description("Show local session state")
    .action(async (sessionId: string) => {
      try {
        console.log(await summarizeSessionState(sessionId, process.cwd()));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export async function summarizeSessionState(sessionId: string, workspaceRoot: string): Promise<string> {
  const session = createSessionRecord(sessionId, workspaceRoot);
  const relativeRoot = path.join(".cc-harness", "sessions", sessionId);
  if (!(await exists(session.paths.root))) {
    throw new Error(`session '${sessionId}' not found at ${relativeRoot}`);
  }

  const [plan, state, verdict] = await Promise.all([
    readPlanWithContext(session.paths.plan, sessionId),
    readStateWithContext(session.paths.state, sessionId),
    readOptionalVerdict(session.paths.verdict),
  ]);

  const currentIndex = clampPhaseIndex(state.phase_index, plan.phases.length);
  const currentPhase = plan.phases[currentIndex];
  const phaseLabel = currentPhase === undefined
    ? `${state.current_phase || "unknown"} (${state.phase_index + 1}/${plan.phases.length})`
    : `${currentPhase.name} (${currentIndex + 1}/${plan.phases.length})`;

  return [
    `Session: ${sessionId}`,
    `Goal:    ${plan.goal}`,
    `Mode:    ${plan.mode}`,
    `Status:  ${state.status}`,
    `Phase:   ${phaseLabel}`,
    `Phases:  ${plan.phases.map(formatPhase).join(" ")}`,
    `Verdict: ${verdict === undefined ? "not written yet" : path.join(relativeRoot, "verdict.json")}`,
    ...(state.last_error === null ? [] : [`Error:   ${state.last_error}`]),
  ].join("\n");
}

async function readPlanWithContext(planPath: string, sessionId: string) {
  try {
    return await readPlan(planPath);
  } catch (error) {
    throw addReadContext(error, `session '${sessionId}' is missing or has invalid plan.json`);
  }
}

async function readStateWithContext(statePath: string, sessionId: string) {
  try {
    return await readState(statePath);
  } catch (error) {
    throw addReadContext(error, `session '${sessionId}' is missing or has invalid state.json`);
  }
}

async function readOptionalVerdict(verdictPath: string): Promise<VerdictFile | undefined> {
  try {
    return await readVerdict(verdictPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw addReadContext(error, "verdict.json exists but could not be read");
  }
}

function formatPhase(phase: { readonly name: string; readonly status: string }): string {
  const marker = phase.status === "complete"
    ? "✓"
    : phase.status === "failed" || phase.status === "blocked"
      ? "✗"
      : phase.status === "running"
        ? "…"
        : "·";
  return `[${phase.name} ${marker}]`;
}

function clampPhaseIndex(index: number, phaseCount: number): number {
  if (phaseCount === 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), phaseCount - 1);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function addReadContext(error: unknown, message: string): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${message}: ${detail}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
