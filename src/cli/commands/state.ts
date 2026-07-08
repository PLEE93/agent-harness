import { Command } from "commander";

export function registerStateCommand(program: Command): void {
  program
    .command("state")
    .argument("<session-id>", "Session identifier to inspect")
    .description("Show local session state")
    .action(() => {
      console.error("cc-harness state is not implemented in this Phase 1 scaffold.");
      process.exitCode = 1;
    });
}
