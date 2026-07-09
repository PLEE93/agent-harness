export interface EvalCaseResult {
  readonly id: string;
  readonly title: string;
  readonly status: "pass" | "fail";
  readonly evidence: string[];
  readonly error?: string;
}

export interface GeneratedFailureCase {
  readonly id: string;
  readonly source_session_id: string;
  readonly goal: string;
  readonly mode: string;
  readonly failure_type: string;
  readonly detail: string;
  readonly expected_behavior: string;
  readonly created_at: string;
}

export interface EvalReport {
  readonly status: "pass" | "fail";
  readonly total_cases: number;
  readonly passed_cases: number;
  readonly failed_cases: number;
  readonly generated_failure_cases: number;
  readonly baseline_comparisons: BaselineComparisonResult[];
  readonly results: EvalCaseResult[];
  readonly quality_claims: QualityClaimResult[];
  readonly report_path?: string;
  readonly generated_cases_path?: string;
}

export interface QualityClaimResult {
  readonly claim: string;
  readonly status: "pass" | "fail";
  readonly evidence: string[];
}

export interface BaselineComparisonResult {
  readonly id: string;
  readonly quality_axis: string;
  readonly raw_agent_baseline: string;
  readonly harness_behavior: string;
  readonly winner: "harness" | "raw_agent" | "tie";
  readonly evidence: string[];
}
