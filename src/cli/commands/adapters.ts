import { Command } from "commander";

export function registerAdaptersCommand(program: Command): void {
  const adapters = program
    .command("adapters")
    .description("Inspect and manage cc-harness adapters");

  adapters
    .command("list")
    .description("List configured adapters")
    .action(() => {
      console.error("cc-harness adapters list is not implemented in this Phase 1 scaffold.");
      process.exitCode = 1;
    });

  adapters
    .command("enable")
    .argument("<adapter>", "Adapter to enable")
    .description("Enable an optional adapter")
    .action(() => {
      console.error("cc-harness adapters enable is not implemented in this Phase 1 scaffold.");
      process.exitCode = 1;
    });
}
