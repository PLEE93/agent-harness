import type { Adapter, ExecuteParams, ExecuteResult } from "../base";
import { invokeClaudeCli, isClaudeCliAvailable } from "./executor";

export class ClaudeCodeAdapter implements Adapter {
  public readonly name = "claude-code";

  public async isAvailable(): Promise<boolean> {
    return isClaudeCliAvailable();
  }

  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    return invokeClaudeCli({
      prompt: buildClaudeCodePrompt(params),
      model: params.model,
      maxTurns: params.max_turns,
      workingDir: params.working_dir,
      permissionMode: params.permissionMode,
    });
  }
}

export function buildClaudeCodePrompt(params: ExecuteParams): string {
  const sections = [
    "You are executing one cc-harness workflow phase.",
    "Return only one valid JSON object matching the output contract in the phase prompt.",
    "Do not wrap the JSON object in Markdown or add prose outside it.",
    "",
    params.prompt.trim(),
  ];

  if (params.max_tool_calls !== undefined) {
    sections.push("", `Phase tool-call budget: ${params.max_tool_calls}`);
  }

  if (params.handoff !== undefined && !params.prompt.includes("Handoff packet:")) {
    sections.push("", `Handoff packet: ${JSON.stringify(params.handoff, null, 2)}`);
  }

  return `${sections.join("\n")}\n`;
}
