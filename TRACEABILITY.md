# Traceability

This repo is a portable extraction of Aurelius harness behavior. Aurelius source is the authority; GPT critique items are secondary.

## Source-Derived Core

- Phase state machine, ledger files, phase outputs, events, plan/state/verdict shape: `/data/v2-tools/harness.py`, `/data/v2-tools/harness_phase_engine.py`.
- Workflow YAML/frontmatter concept and validated phase specs: `/data/v2-tools/harness_workflow.py`, `/data/v2-tools/harness_schemas.py`.
- Standard workflow role law: `/data/system/harness/workflows/standard.md`.
- Standard-high role law: `/data/system/harness/workflows/standard-high.md`.
- Autonomous single-model law: `/data/system/harness/workflows/autonomous.md`.
- Autonomous-high model law: `/data/system/harness/workflows/autonomous-high.md`.

## High-Mode Law

`high` means higher-tier model routing first, not more phases.

- `standard-high` keeps the `standard` phase shape and swaps the orient/plan model seats from `opus` to `fable`.
- `autonomous-high` keeps the `autonomous` phase shape and swaps the understand/plan model seats from `caller` to `fable`.
- Non-planning phases keep the same routing as the base mode.

## OSS Support Utilities

These exist because this repo runs outside Aurelius. They are not claims about Aurelius core harness semantics:

- `doctor` checks local terminal prerequisites.
- `adapters` reports local adapter availability and permission capability mapping.
- `eval` runs deterministic fake-adapter regression checks.
- `replay` reconstructs local ledger evidence.
- `benchmark` currently reports deterministic comparisons and blocks live benchmarking unless live prerequisites exist.
- `improve` converts local failure records into patch proposals; it does not mutate the harness automatically.
- `route` is a convenience classifier for terminal users; it is not an Aurelius planner.

## Removed Drift

The prior repo shape made `standard-high` and `autonomous-high` look like extra-phase modes. That was wrong. The mode files now regression-test that high variants preserve the base phase sequence and differ by model routing.
