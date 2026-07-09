import { Command } from "commander";
import { runHarnessEval } from "../../core/evals/runner";

interface EvalOptions {
  readonly json?: boolean;
  readonly writeReport?: boolean;
}

export function registerEvalCommand(program: Command): void {
  program
    .command("eval")
    .description("Run deterministic harness-quality evals and mine prior failures into eval cases")
    .option("--json", "Print the full JSON report")
    .option("--write-report", "Write .cc-harness/evals/latest-report.json")
    .action(async (options: EvalOptions) => {
      try {
        const report = await runHarnessEval({
          workspaceRoot: process.cwd(),
          writeReport: options.writeReport ?? true,
        });
        if (options.json === true) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        console.log(`Status: ${report.status}`);
        console.log(`Cases: ${report.passed_cases}/${report.total_cases} passed`);
        console.log(`Generated failure cases: ${report.generated_failure_cases}`);
        if (report.report_path !== undefined) {
          console.log(`Report: ${report.report_path}`);
        }
        if (report.generated_cases_path !== undefined) {
          console.log(`Failure cases: ${report.generated_cases_path}`);
        }
        if (report.status !== "pass") {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
