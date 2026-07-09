import path from "node:path";
import { Command } from "commander";
import { ClaudeCodeAdapter } from "../../adapters/claude-code/adapter";
import { resumeSession } from "../../core/resume/resume";
import { resolveWorkflowPath } from "./run";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .argument("<session-id>", "Session identifier to resume")
    .description("Resume a committed cc-harness session")
    .action(async (sessionId: string) => {
      try {
        const outcome = await resumeSession({
          sessionId,
          workspaceRoot: process.cwd(),
          adapter: new ClaudeCodeAdapter(),
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
