import { promises as fs } from "node:fs";
import path from "node:path";

export interface SessionPaths {
  readonly root: string;
  readonly plan: string;
  readonly state: string;
  readonly events: string;
  readonly outputs: string;
  readonly handoffs: string;
  readonly artifacts: string;
  readonly verdict: string;
  readonly summary: string;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly paths: SessionPaths;
}

export interface CreateSessionOptions {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly plan?: unknown;
  readonly state?: unknown;
  readonly verdict?: unknown;
  readonly summary?: string;
}

export type SessionJsonFile = "plan" | "state" | "verdict";

export function getSessionPaths(workspaceRoot: string, sessionId: string): SessionPaths {
  const root = path.join(workspaceRoot, ".cc-harness", "sessions", sessionId);
  return {
    root,
    plan: path.join(root, "plan.json"),
    state: path.join(root, "state.json"),
    events: path.join(root, "events.jsonl"),
    outputs: path.join(root, "outputs"),
    handoffs: path.join(root, "handoffs"),
    artifacts: path.join(root, "artifacts"),
    verdict: path.join(root, "verdict.json"),
    summary: path.join(root, "summary.md"),
  };
}

export async function createSession(options: CreateSessionOptions): Promise<SessionRecord> {
  const record = createSessionRecord(options.sessionId, options.workspaceRoot);
  await fs.mkdir(record.paths.outputs, { recursive: true });
  await fs.mkdir(record.paths.handoffs, { recursive: true });
  await fs.mkdir(record.paths.artifacts, { recursive: true });
  await ensureFile(record.paths.events, "");
  await writeTextFile(record.paths.summary, options.summary ?? "");

  if (options.plan !== undefined) {
    await writeJsonFile(record.paths.plan, options.plan);
  }
  if (options.state !== undefined) {
    await writeJsonFile(record.paths.state, options.state);
  }
  if (options.verdict !== undefined) {
    await writeJsonFile(record.paths.verdict, options.verdict);
  }

  return record;
}

export function createSessionRecord(sessionId: string, workspaceRoot: string): SessionRecord {
  return {
    sessionId,
    paths: getSessionPaths(workspaceRoot, sessionId),
  };
}

export async function readSessionJson<T>(record: SessionRecord, file: SessionJsonFile): Promise<T> {
  return readJsonFile<T>(record.paths[file]);
}

export async function writeSessionJson(record: SessionRecord, file: SessionJsonFile, value: unknown): Promise<void> {
  await writeJsonFile(record.paths[file], value);
}

export async function readOutput<T>(record: SessionRecord, phaseName: string): Promise<T> {
  return readJsonFile<T>(path.join(record.paths.outputs, `${phaseName}.json`));
}

export async function writeOutput(record: SessionRecord, phaseName: string, value: unknown): Promise<string> {
  const outputPath = path.join(record.paths.outputs, `${phaseName}.json`);
  await writeJsonFile(outputPath, value);
  return outputPath;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function ensureFile(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, value, "utf8");
  }
}
