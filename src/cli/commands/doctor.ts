import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";

const execFileAsync = promisify(execFile);

interface CheckResult {
  readonly label: string;
  readonly value: string;
  readonly ok: boolean;
  readonly optional?: boolean;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check local cc-harness prerequisites")
    .action(async () => {
      try {
        const result = await runDoctor(process.cwd());
        console.log(result.output);
        if (!result.ready) {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export async function runDoctor(workspaceRoot: string): Promise<{ output: string; ready: boolean }> {
  const packageJson = await readPackageJson();
  const checks = [
    checkNodeVersion(),
    await checkCommandVersion("Claude CLI", "claude", ["--version"], false),
    await checkCommandVersion("Codex CLI", "codex", ["--version"], true),
    await checkCommandVersion("TypeScript", "tsc", ["--version"], true),
  ];
  const sessionsLine = await describeSessionsDir(workspaceRoot);
  const ready = checks.find((check) => check.label === "Node.js")?.ok === true;

  const lines = [
    `cc-harness v${String(packageJson.version ?? "unknown")}`,
    "",
    ...checks.map(formatCheck),
    "",
    `  Sessions dir  ${sessionsLine}`,
    "",
    ready ? "Ready." : "Node.js 18 or newer is required.",
  ];

  return { output: lines.join("\n"), ready };
}

function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  return {
    label: "Node.js",
    value: `v${version}`,
    ok: Number.isInteger(major) && major >= 18,
  };
}

async function checkCommandVersion(
  label: string,
  command: string,
  args: string[],
  optional: boolean,
): Promise<CheckResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5_000 });
    const value = firstLine(stdout) || firstLine(stderr) || "available";
    return { label, value, ok: true, optional };
  } catch {
    return { label, value: "not found", ok: false, optional };
  }
}

async function describeSessionsDir(workspaceRoot: string): Promise<string> {
  const relativePath = path.join(".cc-harness", "sessions");
  const sessionsPath = path.join(workspaceRoot, relativePath);
  try {
    const entries = await fs.readdir(sessionsPath, { withFileTypes: true });
    const count = entries.filter((entry) => entry.isDirectory()).length;
    return `${relativePath}/ (${count} ${count === 1 ? "session" : "sessions"})`;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return `${relativePath}/ (no sessions yet)`;
    }
    throw error;
  }
}

async function readPackageJson(): Promise<Record<string, unknown>> {
  const packagePath = path.resolve(__dirname, "..", "..", "..", "package.json");
  const raw = await fs.readFile(packagePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function formatCheck(check: CheckResult): string {
  const marker = check.ok ? "✓" : check.optional === true ? "(optional)" : "✗";
  return `  ${check.label.padEnd(12)} ${check.value.padEnd(18)} ${marker}`;
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
