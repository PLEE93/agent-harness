import path from "node:path";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { ClaudeCodeAdapter } from "../../adapters/claude-code/adapter";
import { PhaseEngine } from "../../core/phase_engine/engine";

interface RunOptions {
  readonly mode?: string;
  readonly model?: string;
  readonly with?: string;
  readonly verbose?: boolean;
  readonly dryRun?: boolean;
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .argument("<goal>", "Goal for the harness run")
    .option("--mode <mode>", "Workflow mode", "standard")
    .option("--model <model>", "Caller model identifier")
    .option("--with <adapter>", "Optional adapter name")
    .option("--verbose", "Print verbose execution details")
    .option("--dry-run", "Plan without executing phases")
    .description("Run a goal through a cc-harness workflow")
    .action(async (goal: string, options: RunOptions) => {
      try {
        await runHarness(goal, options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export async function runHarness(goal: string, options: RunOptions): Promise<void> {
  const mode = options.mode ?? "standard";
  if (mode !== "standard") {
    throw new Error(`Phase 1 supports only standard mode; received '${mode}'.`);
  }

  if (options.with !== undefined && !["claude", "claude-code"].includes(options.with)) {
    throw new Error(`Phase 1 supports only the claude-code adapter; received '${options.with}'.`);
  }

  const workspaceRoot = process.cwd();
  const sessionId = `session-${randomUUID()}`;
  const primaryModel = options.model ?? "claude";
  const workflowPath = path.join(workspaceRoot, "src", "modes", `${mode}.yaml`);

  if (options.dryRun === true) {
    console.log(`Dry run: ${goal}`);
    console.log(`Mode: ${mode}`);
    console.log(`Model: ${primaryModel}`);
    console.log(`Workflow: ${path.relative(workspaceRoot, workflowPath)}`);
    return;
  }

  console.log(`Starting cc-harness session ${sessionId}`);
  console.log(`Goal: ${goal}`);
  console.log(`Mode: ${mode}`);
  console.log(`Model: ${primaryModel}`);
  console.log(`Ledger: ${path.join(".cc-harness", "sessions", sessionId)}`);

  const engine = new PhaseEngine({
    sessionId,
    mode,
    goal,
    workspaceRoot,
    workflowPath,
    primaryModel,
    adapter: new ClaudeCodeAdapter(),
  });

  const result = await engine.run();
  console.log(`Status: ${result.status}`);
  console.log(`Verdict: ${path.join(".cc-harness", "sessions", sessionId, "verdict.json")}`);

  if (options.verbose === true) {
    console.log(result.verdict.summary);
  }

  if (result.status !== "complete") {
    process.exitCode = result.status === "blocked" ? 2 : 1;
  }
}
