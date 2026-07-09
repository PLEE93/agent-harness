import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { ClaudeCodeAdapter } from "../../adapters/claude-code/adapter";
import { CodexAdapter } from "../../adapters/codex/adapter";
import type { Adapter, PermissionMode } from "../../adapters/base";
import { loadConfig } from "../../core/config/loader";
import { PhaseEngine } from "../../core/phase_engine/engine";

interface RunOptions {
  readonly mode?: string;
  readonly model?: string;
  readonly with?: string;
  readonly permissionMode?: string;
  readonly verbose?: boolean;
  readonly dryRun?: boolean;
}

const PERMISSION_MODES = new Set<PermissionMode>(["safe", "ask", "trust", "yolo"]);

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .argument("<goal>", "Goal for the harness run")
    .option("--mode <mode>", "Workflow mode (defaults from config or standard)")
    .option("--model <model>", "Caller model identifier")
    .option("--with <adapter>", "Optional adapter name")
    .option("--permission-mode <mode>", "Permission mode: safe, ask, trust, yolo (defaults from config or ask)")
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
  const config = await loadConfig();
  const mode = options.mode ?? config.modes.default;
  const workspaceRoot = process.cwd();
  const sessionId = `session-${randomUUID()}`;
  const primaryModel = options.model ?? "claude";
  const permissionMode = parsePermissionMode(options.permissionMode ?? config.permissions.default);
  const workflowPath = await resolveWorkflowPath(mode);
  const adapter = createAdapter(options.with, config.adapters.codex?.command);

  if (options.dryRun === true) {
    console.log(`Dry run: ${goal}`);
    console.log(`Mode: ${mode}`);
    console.log(`Model: ${primaryModel}`);
    console.log(`Adapter: ${adapter.name}`);
    console.log(`Permission mode: ${permissionMode}`);
    console.log(`Workflow: ${workflowPath}`);
    return;
  }

  console.log(`Starting cc-harness session ${sessionId}`);
  console.log(`Goal: ${goal}`);
  console.log(`Mode: ${mode}`);
  console.log(`Model: ${primaryModel}`);
  console.log(`Adapter: ${adapter.name}`);
  console.log(`Permission mode: ${permissionMode}`);
  console.log(`Ledger: ${path.join(".cc-harness", "sessions", sessionId)}`);

  const engine = new PhaseEngine({
    sessionId,
    mode,
    goal,
    workspaceRoot,
    workflowPath,
    primaryModel,
    modelAliases: config.models,
    permissionMode,
    adapter,
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

export async function resolveWorkflowPath(mode: string): Promise<string> {
  const candidates = [
    path.join(process.cwd(), ".cc-harness", "modes", `${mode}.yaml`),
    path.resolve(__dirname, "..", "..", "..", "modes", `${mode}.yaml`),
    path.resolve(__dirname, "..", "..", "..", "src", "modes", `${mode}.yaml`),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate in the resolution chain.
    }
  }

  throw new Error(
    `mode '${mode}' not found. Available: standard, standard-high, autonomous, autonomous-high. `
      + `Project override: .cc-harness/modes/${mode}.yaml`,
  );
}

function createAdapter(adapterName: string | undefined, codexCommand: string | undefined): Adapter {
  const requested = adapterName ?? "claude-code";
  switch (requested) {
    case "claude":
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "codex":
      return new CodexAdapter({ command: codexCommand });
    default:
      throw new Error(`unknown adapter '${requested}'. Supported adapters: claude-code, codex`);
  }
}

function parsePermissionMode(value: string): PermissionMode {
  if (PERMISSION_MODES.has(value as PermissionMode)) {
    return value as PermissionMode;
  }
  throw new Error(`invalid permission mode '${value}'. Expected one of: safe, ask, trust, yolo`);
}
