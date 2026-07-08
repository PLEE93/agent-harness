export interface Adapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(params: ExecuteParams): Promise<ExecuteResult>;
}

export interface ExecuteParams {
  readonly prompt: string;
  readonly handoff?: object;
  readonly model?: string;
  readonly max_turns?: number;
  readonly working_dir?: string;
  readonly session_id: string;
  readonly phase_name: string;
}

export interface ExecuteResult {
  readonly status: "complete" | "blocked" | "failed";
  readonly output: object;
  readonly raw_transcript?: string;
  readonly artifacts?: string[];
  readonly error?: string;
}
