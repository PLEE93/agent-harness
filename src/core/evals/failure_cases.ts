import { promises as fs } from "node:fs";
import path from "node:path";
import type { GeneratedFailureCase } from "./types";

interface FailureIndexRecord {
  readonly session_id?: string;
  readonly goal?: string;
  readonly mode?: string;
  readonly failure_type?: string;
  readonly detail?: string;
  readonly recorded_at?: string;
}

export async function extractFailureCases(workspaceRoot: string): Promise<GeneratedFailureCase[]> {
  const indexPath = path.join(workspaceRoot, ".cc-harness", "index", "failures.jsonl");
  const records = await readJsonl<FailureIndexRecord>(indexPath);
  return records.map((record, index) => {
    const sessionId = record.session_id ?? `unknown-${index + 1}`;
    const failureType = record.failure_type ?? "unknown_failure";
    return {
      id: `failure-${safeId(sessionId)}-${index + 1}`,
      source_session_id: sessionId,
      goal: record.goal ?? "",
      mode: record.mode ?? "unknown",
      failure_type: failureType,
      detail: record.detail ?? "",
      expected_behavior: expectedBehaviorFor(failureType),
      created_at: new Date().toISOString(),
    };
  });
}

export async function writeFailureCases(workspaceRoot: string, cases: GeneratedFailureCase[]): Promise<string> {
  const filePath = path.join(workspaceRoot, ".cc-harness", "evals", "generated", "failures.jsonl");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = cases.map((item) => JSON.stringify(item)).join("\n");
  await fs.writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
  return filePath;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const rows: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    rows.push(JSON.parse(line) as T);
  }
  return rows;
}

function expectedBehaviorFor(failureType: string): string {
  switch (failureType) {
    case "contract_violation":
      return "Harness must stop the phase, write validation evidence, and avoid running downstream phases.";
    case "rate_limited":
      return "Harness must mark the run blocked with the quota/auth detail preserved for resume.";
    case "auth_blocked":
      return "Harness must mark the run blocked and preserve the credential/auth failure without retry loops.";
    case "loop_limit_reached":
      return "Harness must stop after the configured loop limit and record prior loop outputs.";
    case "adapter_failure":
      return "Harness must fail the run with adapter invocation and raw transcript evidence.";
    default:
      return "Harness must preserve the failure as a replayable eval case with source session context.";
  }
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
