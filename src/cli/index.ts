#!/usr/bin/env node
import { Command } from "commander";
import { registerAdaptersCommand } from "./commands/adapters";
import { registerDoctorCommand } from "./commands/doctor";
import { registerResumeCommand } from "./commands/resume";
import { registerRunCommand } from "./commands/run";
import { registerStateCommand } from "./commands/state";

const version = "0.1.0";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("cc-harness")
    .description("Claude Code-native terminal harness engine")
    .version(version)
    .showHelpAfterError();

  registerRunCommand(program);
  registerResumeCommand(program);
  registerStateCommand(program);
  registerAdaptersCommand(program);
  registerDoctorCommand(program);

  return program;
}

if (require.main === module) {
  buildCli().parseAsync(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
