import { Command } from "commander";
import { routeTask } from "../../core/router/task_router";

interface RouteOptions {
  readonly json?: boolean;
}

export function registerRouteCommand(program: Command): void {
  program
    .command("route")
    .argument("<goal>", "Goal to classify")
    .option("--json", "Print JSON")
    .description("Classify a task into mode, cognition, verifier, artifact schema, and permissions")
    .action((goal: string, options: RouteOptions) => {
      const route = routeTask(goal);
      if (options.json === true) {
        console.log(JSON.stringify(route, null, 2));
        return;
      }
      console.log([
        `Task type: ${route.task_type}`,
        `Mode: ${route.mode}`,
        `Cognition: ${route.cognition_pack}`,
        `Verifier: ${route.verifier}`,
        `Artifact schema: ${route.artifact_schema}`,
        `Permission mode: ${route.permission_mode}`,
        `Reason: ${route.reason}`,
      ].join("\n"));
    });
}
