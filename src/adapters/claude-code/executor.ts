import { spawn } from "node:child_process";
import type { ExecuteResult, PermissionMode } from "../base";
import { parseClaudeStreamJson } from "./parser";

export interface ClaudeCliInvocation {
  readonly prompt: string;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly workingDir?: string;
  readonly permissionMode?: PermissionMode;
}

export function buildClaudeCodeArgv(invocation: ClaudeCliInvocation): string[] {
  const permissionMode = invocation.permissionMode ?? "ask";
  const argv = [
    "claude",
    "--print",
    invocation.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    invocation.model ?? "claude",
    "--max-turns",
    String(invocation.maxTurns ?? 20),
  ];

  if (permissionMode === "yolo") {
    argv.push("--dangerously-skip-permissions");
  }

  return argv;
}

export async function isClaudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["--version"], { shell: false, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export async function invokeClaudeCli(invocation: ClaudeCliInvocation): Promise<ExecuteResult> {
  const argv = buildClaudeCodeArgv(invocation);
  const command = argv[0];
  const args = argv.slice(1);

  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const child = spawn(command, args, {
      cwd: invocation.workingDir,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(classifySpawnError(error));
    });

    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const rawTranscript = [stdoutText, stderrText].filter(Boolean).join("\n");

      if (code === 0 && stdoutText.trim().length > 0) {
        const parsed = parseClaudeStreamJson(stdoutText);
        if (parsed.status === "complete") {
          resolve(parsed);
          return;
        }
        if (stderrText.trim().length === 0) {
          resolve(parsed);
          return;
        }
      }

      if (code !== 0) {
        resolve(classifyCliText(rawTranscript, rawTranscript, `Claude CLI exited with code ${code ?? "unknown"}`));
        return;
      }

      if (stderrText.trim().length > 0) {
        resolve(classifyCliText(stderrText, rawTranscript, "Claude CLI wrote to stderr with no parseable stdout"));
        return;
      }

      resolve({ status: "failed", output: {}, error: "Claude CLI produced no output" });
    });
  });
}

export const executeClaudeCodeCli = invokeClaudeCli;

function classifySpawnError(error: NodeJS.ErrnoException): ExecuteResult {
  if (error.code === "ENOENT") {
    return {
      status: "blocked",
      output: {},
      error: "Claude CLI executable was not found on PATH",
    };
  }
  return {
    status: "failed",
    output: {},
    error: `Claude CLI failed to start: ${error.message}`,
  };
}

function classifyCliText(text: string, rawTranscript: string, fallback: string): ExecuteResult {
  const normalized = text.trim() || fallback;
  if (/rate.?limit|too many requests|quota|429/i.test(normalized)) {
    return { status: "blocked", output: {}, raw_transcript: rawTranscript, error: normalized };
  }
  if (/auth|login|credential|api key|unauthorized|not authenticated|permission denied/i.test(normalized)) {
    return { status: "blocked", output: {}, raw_transcript: rawTranscript, error: normalized };
  }
  if (/validation|invalid argument|unknown option|requires --verbose|usage:/i.test(normalized)) {
    return { status: "failed", output: {}, raw_transcript: rawTranscript, error: normalized };
  }
  return { status: "failed", output: {}, raw_transcript: rawTranscript, error: normalized };
}
