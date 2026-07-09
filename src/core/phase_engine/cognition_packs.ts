export interface CognitionPack {
  readonly name: string;
  readonly body: string;
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
    ].join("\n"),
  },
  epistemic_research: {
    name: "epistemic_research",
    body: [
      "Separate source evidence from inference.",
      "Prefer primary sources and timestamp stale claims.",
      "Track uncertainty instead of smoothing it away.",
      "Name what would change the conclusion.",
    ].join("\n"),
  },
  exec_decision_memo: {
    name: "exec_decision_memo",
    body: [
      "Frame the decision as options with tradeoffs.",
      "Identify asymmetric upside and downside.",
      "Give a recommendation, not only analysis.",
      "Define the next observable action.",
    ].join("\n"),
  },
  code_review: {
    name: "code_review",
    body: [
      "Lead with defects that can change behavior.",
      "Cite the exact mechanism, not style preference.",
      "Check tests, edge cases, and failure paths.",
      "Keep summaries secondary to findings.",
    ].join("\n"),
  },
  refactor_safe: {
    name: "refactor_safe",
    body: [
      "Preserve external behavior unless the phase objective says otherwise.",
      "Identify callers and data-shape contracts before moving code.",
      "Avoid speculative abstractions.",
      "Verify with tests that exercise the moved behavior.",
    ].join("\n"),
  },
};

export function resolveCognitionPack(name: string | undefined): CognitionPack | undefined {
  if (name === undefined || name.trim().length === 0) {
    return undefined;
  }
  return PACKS[name] ?? {
    name,
    body: `No built-in cognition pack named '${name}' was found. Treat the name as a required reasoning style and state how you applied it in the returned JSON.`,
  };
}

export function listCognitionPacks(): string[] {
  return Object.keys(PACKS).sort();
}
