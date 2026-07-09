import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { runHarnessEval } from "../../core/evals/runner";

interface BenchmarkOptions {
  readonly live?: boolean;
  readonly writeReport?: boolean;
  readonly json?: boolean;
}

interface BenchmarkReport {
  readonly kind: "deterministic" | "live";
  readonly status: "pass" | "fail" | "blocked";
  readonly raw_baselines: Record<string, string>;
  readonly harness_results: Record<string, string | number>;
  readonly comparison: string;
  readonly evidence: string[];
  readonly report_path?: string;
}

export function registerBenchmarkCommand(program: Command): void {
  program
    .command("benchmark")
    .option("--live", "Require live raw-vs-harness benchmark execution")
    .option("--write-report", "Write .cc-harness/benchmarks/latest-report.json")
    .option("--json", "Print JSON")
    .description("Compare raw-agent failure modes against harnessed execution")
    .action(async (options: BenchmarkOptions) => {
      try {
        const report = await runBenchmark(process.cwd(), options);
        console.log(options.json === true ? JSON.stringify(report, null, 2) : formatBenchmark(report));
        if (report.status !== "pass") {
          process.exitCode = report.status === "blocked" ? 2 : 1;
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export async function runBenchmark(workspaceRoot: string, options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  if (options.live === true) {
    return {
      kind: "live",
      status: "blocked",
      raw_baselines: {},
      harness_results: {},
      comparison: "Live model-vs-harness benchmarks require installed/authenticated Claude and Codex CLIs and explicit benchmark tasks.",
      evidence: ["No live credentials or task corpus are bundled into the OSS repo."],
    };
  }

  const evalReport = await runHarnessEval({ workspaceRoot, writeReport: options.writeReport });
  let report: BenchmarkReport = {
    kind: "deterministic",
    status: evalReport.status,
    raw_baselines: Object.fromEntries(
      evalReport.baseline_comparisons.map((item) => [item.id, item.raw_agent_baseline]),
    ),
    harness_results: {
      eval_cases: evalReport.total_cases,
      passed_cases: evalReport.passed_cases,
      failed_cases: evalReport.failed_cases,
      baseline_wins: evalReport.baseline_comparisons.filter((item) => item.winner === "harness").length,
    },
    comparison: `${evalReport.baseline_comparisons.filter((item) => item.winner === "harness").length}/${evalReport.baseline_comparisons.length} deterministic baseline comparisons favor harness behavior.`,
    evidence: evalReport.baseline_comparisons.flatMap((item) => item.evidence),
  };

  if (options.writeReport === true) {
    const reportPath = path.join(workspaceRoot, ".cc-harness", "benchmarks", "latest-report.json");
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    report = { ...report, report_path: reportPath };
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

function formatBenchmark(report: BenchmarkReport): string {
  return [
    `Benchmark kind: ${report.kind}`,
    `Status: ${report.status}`,
    `Comparison: ${report.comparison}`,
    `Evidence: ${report.evidence.join("; ") || "none"}`,
    report.report_path === undefined ? "" : `Report: ${report.report_path}`,
  ].filter(Boolean).join("\n");
}
