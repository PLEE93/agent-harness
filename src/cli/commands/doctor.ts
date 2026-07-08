import { Command } from "commander";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check local cc-harness prerequisites")
    .action(() => {
      console.error("cc-harness doctor is not implemented in this Phase 1 scaffold.");
      process.exitCode = 1;
    });
}
