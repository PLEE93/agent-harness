export interface CognitionPack {
  readonly name: string;
  readonly body: string;
  readonly required_fields: string[];
  readonly failure_modes: string[];
}

const PACKS: Record<string, CognitionPack> = {
  senior_engineer_debug: {
    name: "senior_engineer_debug",
    body: [
      "Use hypothesis isolation before editing.",
      "Inspect the relevant source before changing behavior.",
      "Prefer the smallest root-cause fix that changes runtime behavior.",
      "Run the narrowest meaningful test, then the broader regression check.",
      "Report remaining regression risk explicitly.",
      "Your JSON must expose observed_failure, hypotheses, evidence_collected, chosen_root_cause, files_changed, tests_run, and regression_risk when the phase contract allows object detail.",
    ].join("\n"),
    required_fields: ["observed_failure", "hypotheses", "evidence_collected", "chosen_root_cause", "files_changed", "tests_run", "regression_risk"],
    failure_modes: ["editing before source inspection", "patching symptoms", "claiming tests without command evidence"],
  },
  epistemic_research: {
    name: "epistemic_research",
    body: [
      "Separate source evidence from inference.",
      "Prefer primary sources and timestamp stale claims.",
      "Track uncertainty instead of smoothing it away.",
      "Name what would change the conclusion.",
      "Your JSON must separate known_facts, inferences, uncertainties, decision, and next_action when the phase contract allows object detail.",
    ].join("\n"),
    required_fields: ["known_facts", "inferences", "uncertainties", "decision", "next_action"],
    failure_modes: ["treating inference as source evidence", "hiding uncertainty", "using stale claims without timestamping"],
  },
  exec_decision_memo: {
    name: "exec_decision_memo",
    body: [
      "Frame the decision as options with tradeoffs.",
      "Identify asymmetric upside and downside.",
      "Give a recommendation, not only analysis.",
      "Define the next observable action.",
      "Your JSON must expose options, tradeoffs, recommendation, decision_risk, and next_action when the phase contract allows object detail.",
    ].join("\n"),
    required_fields: ["options", "tradeoffs", "recommendation", "decision_risk", "next_action"],
    failure_modes: ["analysis without recommendation", "ignoring downside", "next action not observable"],
  },
  code_review: {
    name: "code_review",
    body: [
      "Lead with defects that can change behavior.",
      "Cite the exact mechanism, not style preference.",
      "Check tests, edge cases, and failure paths.",
      "Keep summaries secondary to findings.",
      "Your JSON must expose defects, mechanism, evidence, tests_checked, edge_cases, and verdict when the phase contract allows object detail.",
    ].join("\n"),
    required_fields: ["defects", "mechanism", "evidence", "tests_checked", "edge_cases", "verdict"],
    failure_modes: ["style review instead of behavior review", "missing failure paths", "uncited defect mechanism"],
  },
  refactor_safe: {
    name: "refactor_safe",
    body: [
      "Preserve external behavior unless the phase objective says otherwise.",
      "Identify callers and data-shape contracts before moving code.",
      "Avoid speculative abstractions.",
      "Verify with tests that exercise the moved behavior.",
      "Your JSON must expose behavior_to_preserve, callers_checked, data_contracts, changes_made, tests_run, and residual_risk when the phase contract allows object detail.",
    ].join("\n"),
    required_fields: ["behavior_to_preserve", "callers_checked", "data_contracts", "changes_made", "tests_run", "residual_risk"],
    failure_modes: ["unneeded abstraction", "caller contract drift", "behavior change without test evidence"],
  },
};

export function resolveCognitionPack(name: string | undefined): CognitionPack | undefined {
  if (name === undefined || name.trim().length === 0) {
    return undefined;
  }
  return PACKS[name] ?? {
    name,
    body: `No built-in cognition pack named '${name}' was found. Treat the name as a required reasoning style and state how you applied it in the returned JSON.`,
    required_fields: [],
    failure_modes: ["unknown cognition pack"],
  };
}

export function listCognitionPacks(): string[] {
  return Object.keys(PACKS).sort();
}
