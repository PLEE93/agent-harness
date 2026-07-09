import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import { permissionCapabilityMatrix } from "../../adapters/permissions";

const execFileAsync = promisify(execFile);

interface AdapterStatus {
  readonly name: string;
  readonly kind: "built-in" | "optional";
  readonly available: boolean | null;
  readonly detail: string;
}

export function registerAdaptersCommand(program: Command): void {
  const adapters = program
    .command("adapters")
    .description("Inspect and manage cc-harness adapters");

  adapters
    .command("list")
    .option("--permissions", "Include effective permission capability matrix")
    .description("List configured adapters")
    .action(async (options: { permissions?: boolean }) => {
      try {
        console.log(formatAdapters(await listAdapters(), options.permissions === true));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  adapters
    .command("enable")
    .argument("<adapter>", "Adapter to enable")
    .description("Enable an optional adapter")
    .action(async (adapter: string) => {
      try {
        console.log(await enableAdapter(adapter));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export async function listAdapters(): Promise<AdapterStatus[]> {
  const [claude, codex] = await Promise.all([
    commandVersion("claude"),
    commandVersion("codex"),
  ]);

  return [
    {
      name: "claude-code",
      kind: "built-in",
      available: claude.available,
      detail: claude.available ? `✓ available (${claude.version})` : "✗ not found",
    },
    {
      name: "codex",
      kind: "optional",
      available: codex.available,
      detail: codex.available ? `✓ available (${codex.version})` : "✗ not found",
    },
    {
      name: "fake",
      kind: "built-in",
      available: null,
      detail: "(testing only)",
    },
  ];
}

export async function enableAdapter(adapter: string): Promise<string> {
  if (adapter !== "codex") {
    throw new Error(`unknown optional adapter '${adapter}'. Supported optional adapter: codex`);
  }

  const codex = await commandVersion("codex");
  if (codex.available) {
    const commandPath = await resolveCommandPath("codex");
    return `Codex CLI found at ${commandPath}. Use --with codex to activate.`;
  }

  return [
    "Codex adapter requires: npm install -g @openai/codex",
    "Once installed, use: cc-harness run \"<goal>\" --with codex",
  ].join("\n");
}

function formatAdapters(adapters: AdapterStatus[], includePermissions = false): string {
  const lines = [
    "Adapters:",
    ...adapters.map((adapter) => `  ${adapter.name.padEnd(13)} ${adapter.kind.padEnd(9)} ${adapter.detail}`),
  ];
  if (includePermissions) {
    lines.push("", "Permission capabilities:");
    for (const adapter of adapters.filter((item) => item.name !== "fake")) {
      for (const capability of permissionCapabilityMatrix(adapter.name)) {
        lines.push(
          `  ${capability.adapter.padEnd(13)} ${capability.mode.padEnd(5)} fs=${capability.filesystem} net=${capability.network} approval=${capability.approval} destructive=${capability.destructive_actions} harness_enforced=${capability.enforced_by_harness}`,
        );
        lines.push(`    ${capability.note}`);
      }
    }
  }
  return lines.join("\n");
}

async function commandVersion(command: string): Promise<{ available: boolean; version: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], { timeout: 5_000 });
    return { available: true, version: firstLine(stdout) || firstLine(stderr) || "available" };
  } catch {
    return { available: false, version: "not found" };
  }
}

async function resolveCommandPath(command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("command", ["-v", command], { shell: true, timeout: 5_000 });
    return firstLine(stdout) || command;
  } catch {
    return command;
  }
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}
