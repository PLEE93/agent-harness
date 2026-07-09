import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "../../core/config/loader";
import { createSessionRecord } from "../../core/ledger/session";
import { readPlan } from "../../core/ledger/plan";
import { resumeSession } from "../../core/resume/resume";
import { createAdapter, createModelAliases, createSeatAdapters, resolveWorkflowPath } from "./run";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .argument("<session-id>", "Session identifier to resume")
    .description("Resume a committed cc-harness session")
    .action(async (sessionId: string) => {
      try {
        const workspaceRoot = process.cwd();
        const config = await loadConfig(workspaceRoot);
        const session = createSessionRecord(sessionId, workspaceRoot);
        const plan = await readPlan(session.paths.plan);
        const adapters = createSeatAdapters(config, undefined, plan.routing);
        const modelAliases = createModelAliases(config, plan.routing);
        const outcome = await resumeSession({
          sessionId,
          workspaceRoot,
          adapter: adapters.caller ?? createAdapter("claude-code", config),
          adapters,
          modelAliases,
          permissionMode: plan.routing?.permission_mode === "safe" || plan.routing?.permission_mode === "ask" || plan.routing?.permission_mode === "trust" || plan.routing?.permission_mode === "yolo"
            ? plan.routing.permission_mode
            : config.permissions.default,
          resolveWorkflowPath,
        });

        if (!outcome.resumed) {
          console.log(`Session: ${outcome.sessionId}`);
          console.log(`Status:  ${outcome.status}`);
          console.log(outcome.message);
          process.exitCode = 1;
          return;
        }

        console.log(`Session: ${outcome.sessionId}`);
        console.log(`Status:  ${outcome.result.status}`);
        console.log(`Verdict: ${path.join(".cc-harness", "sessions", outcome.sessionId, "verdict.json")}`);
        if (outcome.result.status !== "complete") {
          process.exitCode = outcome.result.status === "blocked" ? 2 : 1;
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
