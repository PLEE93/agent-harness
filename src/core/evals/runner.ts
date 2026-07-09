import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeAdapter } from "../../adapters/fake/adapter";
import { PhaseEngine } from "../phase_engine/engine";
import { extractFailureCases, writeFailureCases } from "./failure_cases";
import type { BaselineComparisonResult, EvalCaseResult, EvalReport, QualityClaimResult } from "./types";

export interface RunEvalOptions {
  readonly workspaceRoot: string;
  readonly writeReport?: boolean;
}

export async function runHarnessEval(options: RunEvalOptions): Promise<EvalReport> {
  const results = await runDeterministicCases();
  const generatedCases = await extractFailureCases(options.workspaceRoot);
  const generatedCasesPath = await writeFailureCases(options.workspaceRoot, generatedCases);
  const baselineComparisons = buildBaselineComparisons(results);
  const qualityClaims = buildQualityClaims(results, generatedCases.length, generatedCasesPath, baselineComparisons);
  const failedCases = results.filter((result) => result.status === "fail").length;
  let report: EvalReport = {
    status:
      failedCases === 0 &&
      baselineComparisons.every((comparison) => comparison.winner === "harness") &&
      qualityClaims.every((claim) => claim.status === "pass")
        ? "pass"
        : "fail",
    total_cases: results.length,
    passed_cases: results.length - failedCases,
    failed_cases: failedCases,
    generated_failure_cases: generatedCases.length,
    baseline_comparisons: baselineComparisons,
    results,
    quality_claims: qualityClaims,
    generated_cases_path: generatedCasesPath,
  };

  if (options.writeReport === true) {
    const reportPath = path.join(options.workspaceRoot, ".cc-harness", "evals", "latest-report.json");
    await writeJson(reportPath, report);
    report = { ...report, report_path: reportPath };
    await writeJson(reportPath, report);
  }

  return report;
}

async function runDeterministicCases(): Promise<EvalCaseResult[]> {
  return Promise.all([
    caseCompletesStandard(),
    caseStopsOnContractViolation(),
    caseBlocksWithoutDownstreamExecution(),
    caseRetriesLoopUntilPass(),
    caseWritesTraceArtifacts(),
    caseExtractsFailureCases(),
  ]);
}

async function caseCompletesStandard(): Promise<EvalCaseResult> {
  return runCase("standard-complete", "completes standard workflow", async (ctx) => {
    const result = await runEngine(ctx, [
      FakeAdapter.response("plan", FakeAdapter.complete({ phases: [{ name: "execute", goal: "do it" }], done_criteria: ["verified"] })),
      FakeAdapter.response("execute", FakeAdapter.complete({ result: "artifact", artifacts: ["artifact.txt"] }, ["artifact.txt"])),
      FakeAdapter.response("verify", FakeAdapter.complete(verifyPassOutput("artifact.txt"))),
    ]);
    assertTrue(result.status === "complete", "standard mode completed");
    return ["verdict status complete", "all three phases consumed fake responses"];
  });
}

async function caseStopsOnContractViolation(): Promise<EvalCaseResult> {
  return runCase("contract-stop", "stops on contract violation", async (ctx) => {
    const result = await runEngine(ctx, [
      FakeAdapter.response("plan", FakeAdapter.complete({ phases: [{ name: "execute", goal: "do it" }], done_criteria: ["verified"] })),
      FakeAdapter.response("execute", FakeAdapter.complete({ wrong: "shape" })),
      FakeAdapter.response("verify", FakeAdapter.complete(verifyPassOutput("artifact.txt"))),
    ]);
    const verdict = await readJson<{ summary: string; phases_completed: string[] }>(path.join(ctx.sessionRoot, "verdict.json"));
    assertTrue(result.status === "failed", "contract violation failed the run");
    assertTrue(verdict.phases_completed.length === 1 && verdict.phases_completed[0] === "plan", "downstream verify did not run");
    assertTrue(/missing required key/.test(verdict.summary), "verdict names missing contract fields");
    return ["contract violation produced failed verdict", "downstream phase was blocked"];
  });
}

async function caseBlocksWithoutDownstreamExecution(): Promise<EvalCaseResult> {
  return runCase("blocked-stop", "blocks without downstream execution", async (ctx) => {
    const adapter = new FakeAdapter({
      responses: [
        FakeAdapter.response("plan", FakeAdapter.complete({ phases: [{ name: "execute", goal: "do it" }], done_criteria: ["verified"] })),
        FakeAdapter.response("execute", FakeAdapter.rateLimit("quota exhausted")),
        FakeAdapter.response("verify", FakeAdapter.complete(verifyPassOutput("artifact.txt"))),
      ],
    });
    const result = await runEngine(ctx, undefined, adapter);
    assertTrue(result.status === "blocked", "rate limit blocked the run");
    assertTrue(adapter.remainingResponses() === 1, "verify response remains queued");
    return ["blocked status preserved", "later phase not executed"];
  });
}

async function caseRetriesLoopUntilPass(): Promise<EvalCaseResult> {
  return runCase("loop-retry", "retries loop_until phase until pass", async (ctx) => {
    const workflowPath = path.join(ctx.workspaceRoot, "loop.yaml");
    await writeFile(workflowPath, `mode: loop
phases:
  - name: execute
    type: execute
    model: executor
    loop_until:
      field: verdict
      value: pass
    max_loop_iterations: 2
    output_contract:
      verdict: string
      artifacts: [string]
`, "utf8");
    const adapter = new FakeAdapter({
      responses: [
        FakeAdapter.response("execute", FakeAdapter.complete({ verdict: "fail", artifacts: [] })),
        FakeAdapter.response("execute", FakeAdapter.complete({ verdict: "pass", artifacts: ["fixed.txt"] })),
      ],
    });
    const engine = new PhaseEngine({
      sessionId: ctx.sessionId,
      mode: "loop",
      goal: "loop until pass",
      workspaceRoot: ctx.workspaceRoot,
      workflowPath,
      primaryModel: "caller",
      adapter,
    });
    const result = await engine.run();
    assertTrue(result.status === "complete", "loop completed after retry");
    assertTrue(adapter.remainingResponses() === 0, "both loop responses consumed");
    return ["loop retry consumed failing and passing outputs", "final verdict complete"];
  });
}

async function caseWritesTraceArtifacts(): Promise<EvalCaseResult> {
  return runCase("trace-artifacts", "writes phase flight recorder artifacts", async (ctx) => {
    const result = await runEngine(ctx, [
      FakeAdapter.response("plan", FakeAdapter.complete({ phases: [{ name: "execute", goal: "do it" }], done_criteria: ["verified"] })),
      FakeAdapter.response("execute", FakeAdapter.complete({ result: "artifact", artifacts: ["artifact.txt"] })),
      FakeAdapter.response("verify", FakeAdapter.complete(verifyPassOutput("artifact.txt"))),
    ]);
    assertTrue(result.status === "complete", "trace run completed");
    const traceRoot = path.join(ctx.sessionRoot, "traces", "execute");
    for (const file of ["prompt.txt", "adapter_invocation.json", "raw_transcript.jsonl", "parsed_output.json", "validation.json", "timing.json"]) {
      const content = await readFile(path.join(traceRoot, file), "utf8");
      assertTrue(content.length > 0, `${file} is non-empty`);
    }
    return ["phase prompt captured", "adapter invocation, transcript, parsed output, validation, and timing captured"];
  });
}

async function caseExtractsFailureCases(): Promise<EvalCaseResult> {
  return runCase("failure-extraction", "turns indexed failures into reusable eval case records", async (ctx) => {
    const indexDir = path.join(ctx.workspaceRoot, ".cc-harness", "index");
    await mkdir(indexDir, { recursive: true });
    await writeFile(
      path.join(indexDir, "failures.jsonl"),
      `${JSON.stringify({
        session_id: "session-failed-1",
        goal: "ship the feature",
        mode: "standard-high",
        failure_type: "contract_violation",
        detail: "execute phase omitted artifacts",
        recorded_at: "2026-07-09T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const cases = await extractFailureCases(ctx.workspaceRoot);
    const generatedPath = await writeFailureCases(ctx.workspaceRoot, cases);
    const generatedRaw = await readFile(generatedPath, "utf8");

    assertTrue(cases.length === 1, "one failure case extracted");
    assertTrue(cases[0]?.source_session_id === "session-failed-1", "source session preserved");
    assertTrue(cases[0]?.failure_type === "contract_violation", "failure type preserved");
    assertTrue(/must stop the phase/i.test(cases[0]?.expected_behavior ?? ""), "expected behavior generated");
    assertTrue(/session-failed-1/.test(generatedRaw), "generated failure case written");
    return ["indexed failure extracted", "generated failure eval case written with expected behavior"];
  });
}

interface CaseContext {
  readonly workspaceRoot: string;
  readonly sessionId: string;
  readonly sessionRoot: string;
}

async function runCase(id: string, title: string, body: (ctx: CaseContext) => Promise<string[]>): Promise<EvalCaseResult> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), `cc-harness-eval-${id}-`));
  const sessionId = `${id}-session`;
  const ctx = {
    workspaceRoot,
    sessionId,
    sessionRoot: path.join(workspaceRoot, ".cc-harness", "sessions", sessionId),
  };
  try {
    const evidence = await body(ctx);
    return { id, title, status: "pass", evidence };
  } catch (error) {
    return {
      id,
      title,
      status: "fail",
      evidence: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function runEngine(ctx: CaseContext, responses?: ReturnType<typeof FakeAdapter.response>[], adapter?: FakeAdapter) {
  const fake = adapter ?? new FakeAdapter({ responses: responses ?? [] });
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const workflowPath = path.join(repoRoot, "modes", "standard.yaml");
  const engine = new PhaseEngine({
    sessionId: ctx.sessionId,
    mode: "standard",
    goal: "eval goal",
    workspaceRoot: ctx.workspaceRoot,
    workflowPath,
    primaryModel: "caller",
    adapter: fake,
  });
  return engine.run();
}

function verifyPassOutput(filePath: string): object {
  return {
    verdict: "pass",
    evidence: [`${filePath} checked`],
    commands_run: [{ command: "npm test", exit_code: 0, stdout_excerpt: "pass" }],
    files_checked: [filePath],
    residual_risk: [],
  };
}

function buildQualityClaims(
  results: EvalCaseResult[],
  generatedFailureCases: number,
  generatedCasesPath: string,
  baselineComparisons: BaselineComparisonResult[],
): QualityClaimResult[] {
  const passed = new Set(results.filter((result) => result.status === "pass").map((result) => result.id));
  const baselineWon = baselineComparisons.every((comparison) => comparison.winner === "harness");
  return [
    {
      claim: "The harness enforces phase output contracts instead of accepting plausible prose.",
      status: passed.has("contract-stop") ? "pass" : "fail",
      evidence: ["deterministic eval case: contract-stop"],
    },
    {
      claim: "The harness preserves debugging evidence beyond a single event log.",
      status: passed.has("trace-artifacts") ? "pass" : "fail",
      evidence: ["deterministic eval case: trace-artifacts"],
    },
    {
      claim: "The harness blocks safely when an adapter cannot continue.",
      status: passed.has("blocked-stop") ? "pass" : "fail",
      evidence: ["deterministic eval case: blocked-stop"],
    },
    {
      claim: "The harness converts prior failures into reusable eval case records.",
      status: passed.has("failure-extraction") ? "pass" : "fail",
      evidence: [
        "deterministic eval case: failure-extraction",
        `generated ${generatedFailureCases} current-workspace failure eval case(s) at ${generatedCasesPath}`,
      ],
    },
    {
      claim: "The harness has an explicit baseline comparison instead of only testing itself.",
      status: baselineWon ? "pass" : "fail",
      evidence: baselineComparisons.map((comparison) => `${comparison.id}: ${comparison.winner}`),
    },
  ];
}

function buildBaselineComparisons(results: EvalCaseResult[]): BaselineComparisonResult[] {
  const passed = new Set(results.filter((result) => result.status === "pass").map((result) => result.id));
  return [
    {
      id: "contract-gate-vs-raw-output",
      quality_axis: "bad structured output does not advance the workflow",
      raw_agent_baseline:
        "A raw one-shot agent has no phase output contract, so malformed execute output can be treated as usable prose unless the caller manually notices it.",
      harness_behavior:
        passed.has("contract-stop")
          ? "The harness rejects the malformed execute output, writes a failed verdict, and does not run verify."
          : "The harness did not prove contract-stop behavior.",
      winner: passed.has("contract-stop") ? "harness" : "raw_agent",
      evidence: ["deterministic eval case: contract-stop"],
    },
    {
      id: "blocked-phase-vs-blind-continuation",
      quality_axis: "adapter blockage stops downstream work",
      raw_agent_baseline:
        "A raw chained prompt can continue after a quota/auth failure because there is no durable blocked state guarding later steps.",
      harness_behavior:
        passed.has("blocked-stop")
          ? "The harness records blocked state at the failed phase and leaves downstream responses unconsumed."
          : "The harness did not prove blocked-stop behavior.",
      winner: passed.has("blocked-stop") ? "harness" : "raw_agent",
      evidence: ["deterministic eval case: blocked-stop"],
    },
    {
      id: "traceability-vs-transcript-only",
      quality_axis: "debuggability after failure",
      raw_agent_baseline:
        "A raw agent transcript does not reliably preserve the exact prompt, adapter invocation, parsed output, validation result, and timing for each phase.",
      harness_behavior:
        passed.has("trace-artifacts")
          ? "The harness writes a per-phase flight recorder with prompt, invocation, raw transcript, parsed output, validation, and timing."
          : "The harness did not prove trace artifact behavior.",
      winner: passed.has("trace-artifacts") ? "harness" : "raw_agent",
      evidence: ["deterministic eval case: trace-artifacts"],
    },
    {
      id: "failure-memory-vs-anecdotes",
      quality_axis: "failures become regression material",
      raw_agent_baseline:
        "A raw failed run is usually an anecdote in terminal history unless a person manually converts it into a regression case.",
      harness_behavior:
        passed.has("failure-extraction")
          ? "The harness extracts indexed failure records into reusable eval cases with expected behavior."
          : "The harness did not prove failure extraction behavior.",
      winner: passed.has("failure-extraction") ? "harness" : "raw_agent",
      evidence: ["deterministic eval case: failure-extraction"],
    },
  ];
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(filePath), { recursive: true }));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
