import type { Adapter, ExecuteParams, ExecuteResult } from "../base";

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
