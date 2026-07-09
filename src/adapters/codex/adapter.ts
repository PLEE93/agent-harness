import { spawn } from "node:child_process";
import type { Adapter, ExecuteParams, ExecuteResult, PermissionMode } from "../base";

export interface CodexAdapterConfig {
  readonly command?: string;
}

export interface CodexCliInvocation {
  readonly command?: string;
  readonly prompt: string;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly workingDir?: string;
  readonly permissionMode?: PermissionMode;
}

interface CodexJsonEvent {
  readonly type?: unknown;
  readonly event?: unknown;
  readonly status?: unknown;
  readonly role?: unknown;
  readonly item?: unknown;
  readonly message?: unknown;
  readonly content?: unknown;
  readonly text?: unknown;
  readonly output?: unknown;
  readonly result?: unknown;
  readonly response?: unknown;
  readonly error?: unknown;
  readonly [key: string]: unknown;
}

export class CodexAdapter implements Adapter {
  public readonly name = "codex";
  private readonly command: string;

  public constructor(config: CodexAdapterConfig = {}) {
    this.command = config.command ?? "codex";
  }

  public async isAvailable(): Promise<boolean> {
    return isCodexCliAvailable(this.command);
  }

  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    return invokeCodexCli({
      command: this.command,
      prompt: buildCodexPrompt(params),
      model: params.model,
      maxTurns: params.max_turns,
      workingDir: params.working_dir,
      permissionMode: params.permissionMode,
    });
  }
}

export function buildCodexPrompt(params: ExecuteParams): string {
  const sections = [
    "You are executing one cc-harness workflow phase.",
    "Return only one valid JSON object matching the output contract in the phase prompt.",
    "Do not wrap the JSON object in Markdown or add prose outside it.",
    "",
    params.prompt.trim(),
  ];

  if (params.max_turns !== undefined) {
    sections.push("", `Phase turn budget: ${params.max_turns}`);
  }

  if (params.max_tool_calls !== undefined) {
    sections.push("", `Phase tool-call budget: ${params.max_tool_calls}`);
  }

  if (params.handoff !== undefined && !params.prompt.includes("Handoff packet:")) {
    sections.push("", `Handoff packet: ${JSON.stringify(params.handoff, null, 2)}`);
  }

  return `${sections.join("\n")}\n`;
}

export function buildCodexArgv(invocation: CodexCliInvocation): string[] {
  const command = invocation.command ?? "codex";
  const argv = [
    command,
    "exec",
    "--json",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--ephemeral",
    ...codexPermissionArgs(invocation.permissionMode ?? "ask"),
  ];

  if (invocation.model !== undefined && invocation.model.trim().length > 0) {
    argv.push("--model", invocation.model);
  }

  argv.push(invocation.prompt);
  return argv;
}

export async function isCodexCliAvailable(command = "codex"): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { shell: false, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export async function invokeCodexCli(invocation: CodexCliInvocation): Promise<ExecuteResult> {
  const available = await isCodexCliAvailable(invocation.command ?? "codex");
  if (!available) {
    return {
      status: "failed",
      output: {},
      error: "Codex CLI executable was not found on PATH",
    };
  }

  const argv = buildCodexArgv(invocation);
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
        const parsed = parseCodexJsonOutput(stdoutText);
        if (parsed.status === "complete") {
          resolve({ ...parsed, raw_transcript: rawTranscript });
          return;
        }
        if (stderrText.trim().length === 0) {
          resolve(parsed);
          return;
        }
      }

      if (code !== 0) {
        resolve(classifyCliText(rawTranscript, rawTranscript, `Codex CLI exited with code ${code ?? "unknown"}`));
        return;
      }

      if (stderrText.trim().length > 0) {
        resolve(classifyCliText(stderrText, rawTranscript, "Codex CLI wrote to stderr with no parseable stdout"));
        return;
      }

      resolve({ status: "failed", output: {}, error: "Codex CLI produced no output" });
    });
  });
}

export function parseCodexJsonOutput(stdoutText: string): ExecuteResult {
  const raw = stdoutText.trim();
  if (raw.length === 0) {
    return failed("Codex JSON output was empty", stdoutText);
  }

  const directOutput = parseOutputObject(raw);
  if (directOutput !== undefined && !looksLikeCodexEvent(directOutput)) {
    return complete(directOutput, stdoutText);
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates: string[] = [];
  let lastEvent: Record<string, unknown> | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    let event: CodexJsonEvent;
    try {
      event = JSON.parse(lines[index]) as CodexJsonEvent;
    } catch (error) {
      return failed(`Unable to parse Codex JSON line ${index + 1}: ${errorMessage(error)}`, stdoutText);
    }

    if (!isRecord(event)) {
      continue;
    }
    lastEvent = event;

    const eventFailure = classifyEventFailure(event);
    if (eventFailure !== undefined) {
      return { ...eventFailure, raw_transcript: stdoutText };
    }

    candidates.push(...extractCodexEventText(event));
  }

  const directLastEvent = lastEvent !== undefined && !looksLikeCodexEvent(lastEvent)
    ? parseOutputObject(JSON.stringify(lastEvent))
    : undefined;
  if (directLastEvent !== undefined) {
    return complete(directLastEvent, stdoutText);
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const output = parseOutputObject(candidates[index]);
    if (output !== undefined) {
      return complete(output, stdoutText);
    }
  }

  const combined = candidates.join("\n").trim();
  const combinedOutput = combined.length > 0 ? parseOutputObject(combined) : undefined;
  if (combinedOutput !== undefined) {
    return complete(combinedOutput, stdoutText);
  }

  return failed("Codex JSON output did not contain a structured JSON object", stdoutText);
}

function codexPermissionArgs(permissionMode: PermissionMode): string[] {
  switch (permissionMode) {
    case "safe":
      return ["--sandbox", "read-only", "--ask-for-approval", "untrusted"];
    case "trust":
      return ["--sandbox", "workspace-write", "--ask-for-approval", "never"];
    case "yolo":
      return ["--dangerously-bypass-approvals-and-sandbox"];
    case "ask":
    default:
      return ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"];
  }
}

function classifySpawnError(error: NodeJS.ErrnoException): ExecuteResult {
  if (error.code === "ENOENT") {
    return {
      status: "failed",
      output: {},
      error: "Codex CLI executable was not found on PATH",
    };
  }
  return {
    status: "failed",
    output: {},
    error: `Codex CLI failed to start: ${error.message}`,
  };
}

function classifyEventFailure(event: CodexJsonEvent): ExecuteResult | undefined {
  const combinedText = collectStrings(event).join("\n");
  const eventType = typeof event.type === "string" ? event.type : "";
  const eventName = typeof event.event === "string" ? event.event : "";
  const status = typeof event.status === "string" ? event.status : "";

  if (/error|failed|failure/i.test(`${eventType} ${eventName} ${status}`)) {
    return classifyCliText(combinedText, combinedText, "Codex JSON event reported an error");
  }

  if (typeof event.error === "string" && event.error.trim().length > 0) {
    return classifyCliText(event.error, combinedText, event.error);
  }

  if (containsBlockingText(combinedText)) {
    return classifyCliText(combinedText, combinedText, "Codex output reported a blocking condition");
  }

  return undefined;
}

function classifyCliText(text: string, rawTranscript: string, fallback: string): ExecuteResult {
  const normalized = text.trim() || fallback;
  if (/rate.?limit|too many requests|quota|429/i.test(normalized)) {
    return { status: "blocked", output: {}, raw_transcript: rawTranscript, error: normalized };
  }
  if (/auth|login|credential|api key|unauthorized|not authenticated|permission denied/i.test(normalized)) {
    return { status: "blocked", output: {}, raw_transcript: rawTranscript, error: normalized };
  }
  if (/validation|invalid argument|unknown option|usage:/i.test(normalized)) {
    return { status: "failed", output: {}, raw_transcript: rawTranscript, error: normalized };
  }
  return { status: "failed", output: {}, raw_transcript: rawTranscript, error: normalized };
}

function containsBlockingText(text: string): boolean {
  return /rate.?limit|too many requests|quota|429|auth|login|credential|api key|unauthorized|not authenticated|permission denied/i.test(text);
}

function extractCodexEventText(event: CodexJsonEvent): string[] {
  if (event.role === "assistant") {
    return collectStrings(event);
  }

  if (isRecord(event.item) && event.item.role === "assistant") {
    return collectStrings(event.item);
  }

  return [
    ...collectFieldStrings(event.final_response),
    ...collectFieldStrings(event.final_message),
    ...collectFieldStrings(event.output),
    ...collectFieldStrings(event.result),
    ...collectFieldStrings(event.response),
    ...collectFieldStrings(event.message),
    ...collectFieldStrings(event.content),
    ...collectFieldStrings(event.text),
  ];
}

function collectFieldStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return collectStrings(value);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.values(value).flatMap((item) => collectStrings(item));
}

function parseOutputObject(text: string): Record<string, unknown> | undefined {
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    candidates.push(fenced[1].trim());
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function complete(output: Record<string, unknown>, rawTranscript: string): ExecuteResult {
  return {
    status: "complete",
    output,
    raw_transcript: rawTranscript,
    artifacts: extractArtifacts(output),
  };
}

function extractArtifacts(output: Record<string, unknown>): string[] {
  if (!Array.isArray(output.artifacts)) {
    return [];
  }
  return output.artifacts.filter((artifact): artifact is string => typeof artifact === "string");
}

function failed(error: string, rawTranscript?: string): ExecuteResult {
  return { status: "failed", output: {}, error: normalizeError(error), raw_transcript: rawTranscript };
}

function normalizeError(error: string): string {
  return error.trim() || "Codex JSON parsing failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeCodexEvent(value: Record<string, unknown>): boolean {
  return value.type !== undefined
    || value.event !== undefined
    || value.item !== undefined
    || value.message !== undefined
    || value.delta !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
