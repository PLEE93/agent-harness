import type { Adapter, ExecuteParams, ExecuteResult } from "../base";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface FakeAdapterResponse {
  readonly phase?: string;
  readonly result: ExecuteResult;
}

export interface FakeAdapterConfig {
  readonly responses: FakeAdapterResponse[];
}

export class FakeAdapter implements Adapter {
  public readonly name = "fake";
  private readonly responses: FakeAdapterResponse[];

  public constructor(config: FakeAdapterConfig = { responses: [] }) {
    this.responses = [...config.responses];
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public enqueue(response: FakeAdapterResponse): void {
    this.responses.push(response);
  }

  public remainingResponses(): number {
    return this.responses.length;
  }

  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const responseIndex = this.responses.findIndex((response) =>
      response.phase === undefined || response.phase === params.phase_name,
    );

    if (responseIndex === -1) {
      return FakeAdapter.failed(`fake adapter has no response queued for phase '${params.phase_name}'`);
    }

    const [response] = this.responses.splice(responseIndex, 1);
    if (response.result.status === "complete" && params.working_dir !== undefined) {
      await materializeArtifacts(params.working_dir, [
        ...(response.result.artifacts ?? []),
        ...extractArtifacts(response.result.output),
      ]);
    }
    return response.result;
  }

  public static response(phase: string | undefined, result: ExecuteResult): FakeAdapterResponse {
    return { phase, result };
  }

  public static complete(output: object, artifacts: string[] = []): ExecuteResult {
    return {
      status: "complete",
      output,
      artifacts,
      raw_transcript: JSON.stringify(output),
    };
  }

  public static blocked(reason = "quota exceeded"): ExecuteResult {
    return {
      status: "blocked",
      output: {
        status: "blocked",
        open_questions: [reason],
      },
      error: reason,
      raw_transcript: reason,
    };
  }

  public static failed(reason = "runtime failure"): ExecuteResult {
    return {
      status: "failed",
      output: {
        error: reason,
      },
      error: reason,
      raw_transcript: reason,
    };
  }

  public static wrongContract(): ExecuteResult {
    return FakeAdapter.complete({ unexpected: "value" });
  }

  public static wrongTypes(): ExecuteResult {
    return FakeAdapter.complete({
      phases: "not an array",
      done_criteria: [1, 2, 3] as unknown as string[],
    });
  }

  public static invalidJson(raw = "not-json"): ExecuteResult {
    return {
      status: "complete",
      output: raw as unknown as object,
      raw_transcript: raw,
    };
  }

  public static rateLimit(reason = "rate limit exceeded"): ExecuteResult {
    return FakeAdapter.blocked(reason);
  }

  public static auth(reason = "authentication required"): ExecuteResult {
    return FakeAdapter.blocked(reason);
  }
}

async function materializeArtifacts(workingDir: string, artifacts: string[]): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.trim().length === 0 || path.isAbsolute(artifact) || artifact.includes("..")) {
      continue;
    }
    const artifactPath = path.join(workingDir, artifact);
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, `fake artifact: ${artifact}\n`, "utf8");
  }
}

function extractArtifacts(output: object): string[] {
  if (!isRecord(output) || !Array.isArray(output.artifacts)) {
    return [];
  }
  return output.artifacts.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
