import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { extractFailureCases, writeFailureCases } from "../../core/evals/failure_cases";

interface ImproveOptions {
  readonly fromFailures?: boolean;
  readonly json?: boolean;
}

interface ImprovementCluster {
  readonly failure_type: string;
  readonly count: number;
  readonly likely_fix_type: "prompt_patch" | "mode_patch" | "adapter_parser_patch" | "schema_patch" | "docs_patch";
  readonly proposed_action: string;
}

interface ImprovementPlan {
  readonly status: "ready" | "empty";
  readonly generated_eval_cases: number;
  readonly generated_cases_path: string;
  readonly clusters: ImprovementCluster[];
  readonly next_commands: string[];
  readonly written_to: string;
}

export function registerImproveCommand(program: Command): void {
  program
    .command("improve")
    .option("--from-failures", "Build an improvement plan from .cc-harness/index/failures.jsonl")
    .option("--json", "Print JSON")
    .description("Convert indexed failures into eval cases and patch proposals")
    .action(async (options: ImproveOptions) => {
      try {
        if (options.fromFailures !== true) {
          throw new Error("improve currently requires --from-failures");
        }
        const plan = await improveFromFailures(process.cwd());
        console.log(options.json === true ? JSON.stringify(plan, null, 2) : formatImprovementPlan(plan));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export async function improveFromFailures(workspaceRoot: string): Promise<ImprovementPlan> {
  const cases = await extractFailureCases(workspaceRoot);
  const generatedCasesPath = await writeFailureCases(workspaceRoot, cases);
  const clusters = clusterFailures(cases.map((item) => item.failure_type));
  const plan: ImprovementPlan = {
    status: cases.length === 0 ? "empty" : "ready",
    generated_eval_cases: cases.length,
    generated_cases_path: generatedCasesPath,
    clusters,
    next_commands: [
      "cc-harness eval --write-report",
      "cc-harness benchmark --write-report",
    ],
    written_to: path.join(workspaceRoot, ".cc-harness", "improvements", "latest-plan.json"),
  };
  await fs.mkdir(path.dirname(plan.written_to), { recursive: true });
  await fs.writeFile(plan.written_to, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return plan;
}

function clusterFailures(failureTypes: string[]): ImprovementCluster[] {
  const counts = new Map<string, number>();
  for (const type of failureTypes) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([failureType, count]) => ({
      failure_type: failureType,
      count,
      likely_fix_type: likelyFixType(failureType),
      proposed_action: proposedAction(failureType),
    }));
}

function likelyFixType(failureType: string): ImprovementCluster["likely_fix_type"] {
  if (/contract|schema|artifact|verification/i.test(failureType)) {
    return "schema_patch";
  }
  if (/adapter|parser|auth|rate/i.test(failureType)) {
    return "adapter_parser_patch";
  }
  if (/loop|mode/i.test(failureType)) {
    return "mode_patch";
  }
  if (/docs/i.test(failureType)) {
    return "docs_patch";
  }
  return "prompt_patch";
}

function proposedAction(failureType: string): string {
  if (/failed_verification|verification/i.test(failureType)) {
    return "Tighten verify output contract and add a deterministic regression case for failed verification.";
  }
  if (/failed_artifact|artifact/i.test(failureType)) {
    return "Add or tighten artifact manifest validation and test claimed-path rejection.";
  }
  if (/adapter|auth|rate/i.test(failureType)) {
    return "Patch adapter error classification and add a fake-adapter reproduction.";
  }
  if (/loop/i.test(failureType)) {
    return "Patch loop limit semantics and add loop replay coverage.";
  }
  return "Add a generated eval case, reproduce, then patch the smallest prompt/mode/tool surface that prevents recurrence.";
}

function formatImprovementPlan(plan: ImprovementPlan): string {
  return [
    `Status: ${plan.status}`,
    `Generated eval cases: ${plan.generated_eval_cases}`,
    `Cases: ${plan.generated_cases_path}`,
    `Plan: ${plan.written_to}`,
    "Clusters:",
    ...(plan.clusters.length === 0
      ? ["  none"]
      : plan.clusters.map((item) => `  ${item.failure_type} x${item.count}: ${item.likely_fix_type} — ${item.proposed_action}`)),
    `Next: ${plan.next_commands.join(" && ")}`,
  ].join("\n");
}
