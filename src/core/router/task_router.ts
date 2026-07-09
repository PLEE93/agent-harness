export type TaskType =
  | "coding_debug"
  | "coding_feature"
  | "refactor"
  | "research"
  | "decision_memo"
  | "audit"
  | "writing"
  | "ops";

export interface TaskRoute {
  readonly task_type: TaskType;
  readonly mode: "standard" | "standard-high" | "autonomous" | "autonomous-high";
  readonly cognition_pack: string;
  readonly verifier: "evidence_native" | "review_only";
  readonly artifact_schema: string;
  readonly permission_mode: "safe" | "ask" | "trust" | "yolo";
  readonly reason: string;
}

export function routeTask(goal: string): TaskRoute {
  const normalized = goal.toLowerCase();
  const highRequested = /\b(high|high-tier|higher-tier|fable|premium model|stronger model)\b/.test(normalized);
  const autonomousRequested = /\b(autonomous|long-running|loop until|keep working|multi-step)\b/.test(normalized);
  const buildMode = autonomousRequested
    ? (highRequested ? "autonomous-high" : "autonomous")
    : (highRequested ? "standard-high" : "standard");
  if (/\b(debug|bug|failing|failure|fix test|broken|regression)\b/.test(normalized)) {
    return route("coding_debug", buildMode, "senior_engineer_debug", "ask", "source defect or failing behavior needs root-cause diagnosis");
  }
  if (/\b(refactor|rename|move|split|extract)\b/.test(normalized)) {
    return route("refactor", buildMode, "refactor_safe", "ask", "behavior preservation matters more than speed");
  }
  if (/\b(build|implement|feature|add|create)\b/.test(normalized)) {
    return route("coding_feature", buildMode, "senior_engineer_debug", "ask", "source change needs plan, execution, and verification");
  }
  if (/\b(audit|review|inspect|critique)\b/.test(normalized)) {
    return route("audit", highRequested ? "standard-high" : "standard", "code_review", "safe", "audit work needs evidence-first review and low write permissions");
  }
  if (/\b(research|compare|sources|market|latest)\b/.test(normalized)) {
    return route("research", "standard", "epistemic_research", "safe", "research needs source/evidence separation");
  }
  if (/\b(decide|decision|tradeoff|recommend|strategy)\b/.test(normalized)) {
    return route("decision_memo", "standard", "exec_decision_memo", "safe", "decision work needs options, tradeoffs, recommendation, and next action");
  }
  if (/\b(deploy|restart|install|server|ops|release)\b/.test(normalized)) {
    return route("ops", buildMode, "senior_engineer_debug", "ask", "operations work needs evidence-native verification and conservative permissions");
  }
  return route("writing", "standard", "exec_decision_memo", "safe", "default route for non-code structured work");
}

function route(
  taskType: TaskType,
  mode: TaskRoute["mode"],
  cognitionPack: string,
  permissionMode: TaskRoute["permission_mode"],
  reason: string,
): TaskRoute {
  return {
    task_type: taskType,
    mode,
    cognition_pack: cognitionPack,
    verifier: taskType === "writing" || taskType === "decision_memo" || taskType === "research" ? "review_only" : "evidence_native",
    artifact_schema: taskType === "coding_debug" || taskType === "coding_feature" || taskType === "refactor" || taskType === "ops"
      ? "files_changed + commands_run + artifact_manifest"
      : "claims + evidence + residual_risk",
    permission_mode: permissionMode,
    reason,
  };
}
