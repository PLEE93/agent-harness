import { Command } from "commander";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .argument("<session-id>", "Session identifier to resume")
    .description("Resume a committed cc-harness session")
    .action(() => {
      console.error("cc-harness resume is not implemented in this Phase 1 scaffold.");
      process.exitCode = 1;
    });
}
