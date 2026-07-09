import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { ClaudeCodeAdapter } from "../../adapters/claude-code/adapter";
import { CodexAdapter } from "../../adapters/codex/adapter";
import type { Adapter, PermissionMode } from "../../adapters/base";
import { loadConfig, type HarnessConfig } from "../../core/config/loader";
import type { PlanRouting } from "../../core/ledger/plan";
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
  const adapters = createSeatAdapters(config, options.with);
  const adapter = adapters.caller ?? createAdapter("claude-code", config);
  const modelAliases = createModelAliases(config);
  const routing = createPlanRouting(config, options.with, modelAliases, permissionMode);

  if (options.dryRun === true) {
    console.log(`Dry run: ${goal}`);
    console.log(`Mode: ${mode}`);
    console.log(`Model: ${primaryModel}`);
    console.log(`Adapter: ${adapter.name}`);
    console.log(`Seat adapters: ${describeSeatAdapters(adapters)}`);
    console.log(`Permission mode: ${permissionMode}`);
    console.log(`Workflow: ${workflowPath}`);
    return;
  }

  console.log(`Starting cc-harness session ${sessionId}`);
  console.log(`Goal: ${goal}`);
  console.log(`Mode: ${mode}`);
  console.log(`Model: ${primaryModel}`);
  console.log(`Adapter: ${adapter.name}`);
  console.log(`Seat adapters: ${describeSeatAdapters(adapters)}`);
  console.log(`Permission mode: ${permissionMode}`);
  console.log(`Ledger: ${path.join(".cc-harness", "sessions", sessionId)}`);

  const engine = new PhaseEngine({
    sessionId,
    mode,
    goal,
    workspaceRoot,
    workflowPath,
    primaryModel,
    modelAliases,
    permissionMode,
    adapter,
    adapters,
    routing,
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

export function createAdapter(adapterName: string | undefined, config: HarnessConfig): Adapter {
  const requested = adapterName ?? "claude-code";
  switch (requested) {
    case "claude":
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "codex":
      return new CodexAdapter({ command: config.adapters.codex?.command });
    default:
      throw new Error(`unknown adapter '${requested}'. Supported adapters: claude-code, codex`);
  }
}

export function createSeatAdapters(
  config: HarnessConfig,
  forcedAdapterName: string | undefined,
  routing?: PlanRouting,
): Record<string, Adapter> {
  const adapters: Record<string, Adapter> = {};
  const seatEntries = Object.entries(routing?.seats ?? config.seats);
  for (const [seat, seatConfig] of seatEntries) {
    adapters[seat] = createAdapter(forcedAdapterName ?? seatConfig.adapter ?? "claude-code", config);
  }
  if (adapters.caller === undefined) {
    adapters.caller = createAdapter(forcedAdapterName ?? "claude-code", config);
  }
  return adapters;
}

export function createModelAliases(config: HarnessConfig, routing?: PlanRouting): Record<string, string> {
  const aliases: Record<string, string> = { ...config.models };
  for (const [seat, seatConfig] of Object.entries(routing?.seats ?? config.seats)) {
    if (seatConfig.model !== undefined && seatConfig.model.trim().length > 0) {
      aliases[seat] = seatConfig.model;
    }
  }
  return aliases;
}

export function createPlanRouting(
  config: HarnessConfig,
  forcedAdapterName: string | undefined,
  modelAliases: Record<string, string>,
  permissionMode: PermissionMode,
): PlanRouting {
  const seats: PlanRouting["seats"] = {};
  for (const [seat, seatConfig] of Object.entries(config.seats)) {
    seats[seat] = {
      adapter: forcedAdapterName ?? seatConfig.adapter ?? "claude-code",
      model: modelAliases[seat] ?? seatConfig.model ?? "caller",
    };
  }
  if (seats.caller === undefined) {
    seats.caller = {
      adapter: forcedAdapterName ?? "claude-code",
      model: modelAliases.caller ?? "caller",
    };
  }
  return { permission_mode: permissionMode, seats };
}

function describeSeatAdapters(adapters: Record<string, Adapter>): string {
  return Object.entries(adapters)
    .map(([seat, adapter]) => `${seat}=${adapter.name}`)
    .sort()
    .join(", ");
}

function parsePermissionMode(value: string): PermissionMode {
  if (PERMISSION_MODES.has(value as PermissionMode)) {
    return value as PermissionMode;
  }
  throw new Error(`invalid permission mode '${value}'. Expected one of: safe, ask, trust, yolo`);
}
