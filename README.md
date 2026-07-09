# agent-harness

**A portable extraction of the Aurelius harness state machine for terminal AI agents.** Gives Claude Code, Codex, and any terminal agent a persistent local state machine: commit a plan, execute phase-by-phase, carry structured outputs forward, and resume across context resets.

The thesis is simple: terminal agents need a durable execution layer outside any one context window. agent-harness turns a goal into a local session ledger with explicit phases, structured handoffs, output contracts, and a final verdict.

Requires Node.js 18+. No cloud service, no MCP server, no database. Pure local filesystem state.

---

## What Works Today (v0.1.0)

- Source-derived Aurelius mode shapes in bundled `modes/*.yaml`: `standard`, `standard-high`, `autonomous`, and `autonomous-high`
- High modes mean **high-tier model routing first**: `standard-high` pins `fable` to orient/plan while keeping the standard phase shape; `autonomous-high` pins `fable` to understand/plan while keeping the autonomous phase shape
- Claude Code adapter via the local `claude` CLI
- Codex adapter via the local `codex` CLI (`cc-harness run --with codex`); PATH availability is checked at runtime and a missing CLI fails honestly instead of crashing
- Local session ledger: `plan.json`, `state.json`, `events.jsonl`, phase outputs, handoffs, and `verdict.json`
- Output contracts and structured handoff packets between phases
- Explicit `seats:` config for per-phase adapter + model routing, e.g. Claude planning, Codex execution, Claude verification
- Config file loading from `cc-harness.config.yaml` (falls back to `~/.agent-harness/cc-harness.config.yaml`, then built-in defaults) for default mode, default permission mode, per-phase model aliases, and per-seat adapters
- Built-in cognition packs injected into phase prompts (`senior_engineer_debug`, `epistemic_research`, `exec_decision_memo`, `code_review`, `refactor_safe`)
- Cognition packs include structured obligations and known failure modes, not just advice text
- Verdicts split harness execution from task success: `execution_status`, `verification_status`, and `final_status`
- Verify phases require evidence-native output: command results, files checked, evidence, and residual risk
- Artifact manifests validate claimed artifacts stay inside the workspace, exist, and include size + SHA-256
- Per-phase flight recorder under each session: prompt, adapter invocation, handoff, raw transcript, parsed output, validation, and timing
- Local run index under `.cc-harness/index/` for sessions and classified failures
- OSS support utilities, not Aurelius core semantics: `eval`, `replay`, `benchmark`, `improve`, and `route`
- Deterministic JavaScript test suite: `npm test` (fake adapter only, no live CLI calls)
- `cc-harness run "<goal>" --mode standard`
- `cc-harness run "<goal>" --mode <any bundled mode> --dry-run`
- `cc-harness doctor`
- `cc-harness state <session-id>`
- `cc-harness resume <session-id>` for committed non-terminal sessions
- `cc-harness adapters list`
- `cc-harness adapters enable codex` as a prerequisite check and usage hint

## In Progress

- Live, end-to-end verified runs of all source-derived modes against real Claude/Codex models — the YAML, engine, config, and CLI wiring is in place, but the deterministic test gate does not invoke live model CLIs
- Live per-seat mixed-adapter runs — `planner`/`executor`/`verifier` seats now select adapters and models from `cc-harness.config.yaml`, but the deterministic test gate still does not invoke real Claude/Codex processes
- Live benchmark suite comparing harnessed agents against raw model use on the same real tasks — `cc-harness eval` now proves deterministic quality properties and baseline failure prevention, but it does not yet run live model-vs-model benchmarks
- Project-level mode overrides at `.cc-harness/modes/<mode>.yaml` — the resolution chain supports it, but it is not covered by the deterministic test suite

---

## Install

```bash
git clone https://github.com/PLEE93/agent-harness.git ~/.agent-harness
cd ~/.agent-harness
npm install
npm run build
```

Verify the CLI builds:

```bash
node ~/.agent-harness/dist/cli/index.js --help
```

Expected output starts with:

```text
Usage: cc-harness [options] [command]

Claude Code-native terminal harness engine
```

Install globally:

```bash
cd ~/.agent-harness && npm link
```

After this, `cc-harness` works as a global command. If you skip this step, replace every `cc-harness` below with `node ~/.agent-harness/dist/cli/index.js`.

Check prerequisites:

```bash
cc-harness doctor
```

`doctor` reports the package version, Node.js version, Claude CLI availability, optional Codex CLI availability, optional TypeScript availability, and the local sessions directory status.

---

## E2E Test

This verifies the current supported path: the `standard` source-derived workflow against the local Claude Code CLI.

```bash
cc-harness run "what is the capital of France" --mode standard --verbose
```

Expected behavior:

1. Harness creates `.cc-harness/sessions/<id>/` in the current project.
2. Runs the `standard` workflow: `orient -> research -> plan -> execute -> verify -> red_team -> synthesize`.
3. Calls the local `claude` CLI for each phase.
4. Writes `verdict.json` with the final status.

Verify the session:

```bash
ls .cc-harness/sessions/
cc-harness state <session-id>
cat .cc-harness/sessions/<session-id>/verdict.json
```

Expected `verdict.json` shape:

```json
{
  "session_id": "...",
  "goal": "what is the capital of France",
  "mode": "standard",
  "execution_status": "complete",
  "verification_status": "pass",
  "final_status": "success",
  "status": "complete",
  "phases_completed": ["orient", "research", "plan", "execute", "verify", "red_team", "synthesize"]
}
```

`execution_status: complete` means the harness workflow ran to the end. `verification_status: pass` means the verifier returned passing evidence. `final_status: success` is the task-success field; verifier failure produces `execution_status: complete`, `verification_status: fail`, and `final_status: failed_verification`.

---

## Modes

| Mode | Status | Phases |
|---|---|---|
| `standard` | Source-derived, deterministic-tested | `orient -> research -> plan -> execute -> verify -> red_team -> synthesize` |
| `standard-high` | Source-derived, deterministic-tested | Same phase shape as `standard`; `fable` replaces `opus` in orient/plan seats |
| `autonomous` | Source-derived, deterministic-tested | `understand -> plan -> execute (loop) -> verify -> red_team -> synthesize`, all `caller` model |
| `autonomous-high` | Source-derived, deterministic-tested | Same phase shape as `autonomous`; `fable` replaces `caller` in understand/plan seats |

All four modes are bundled in `modes/` and `src/modes/` and resolve via package-relative path lookup. The `*-high` variants are **model routing variants**, not extra-phase variants. Project-level overrides can be placed in `.cc-harness/modes/<mode>.yaml`.

---

## Adapters

### Claude Code

```bash
cc-harness run "fix this bug" --mode standard
```

Uses the local `claude` CLI. Requires Claude Code to be installed and authenticated.

### Specific Claude Model

```bash
cc-harness run "review this code" --mode standard --model claude-opus-4-5
```

The model value is passed to the Claude Code adapter.

### Codex

```bash
cc-harness run "<goal>" --mode standard --with codex
cc-harness adapters enable codex
```

Uses the local `codex` CLI via `CodexAdapter`. Availability is checked on PATH; if Codex is not installed, `--with codex` fails honestly instead of crashing. `adapters enable codex` checks the same availability and prints an install hint when the CLI is missing.

### Permission Capabilities

```bash
cc-harness adapters list --permissions
```

The permission matrix is adapter-specific. Codex modes are mapped by the harness into sandbox/approval settings. Claude Code non-`yolo` modes are delegated to the Claude CLI and are not marketed as equivalent sandbox enforcement. `yolo` is the only Claude mode where cc-harness explicitly passes the dangerous skip-permissions flag.

---

## Per-Seat Routing

Use `seats:` to override a model seat. Literal phase models such as `fable`, `opus`, `codex-5.5`, and `sonnet` are preserved unless a config alias overrides them:

```yaml
seats:
  planner:
    adapter: claude-code
    model: claude-opus-4-5
  executor:
    adapter: codex
    model: gpt-5-codex
  verifier:
    adapter: claude-code
    model: claude-opus-4-5
```

Workflow phases select a seat through their `model:` field. `--with <adapter>` is an override that forces every seat through one adapter for that run.

## Phase Flight Recorder

Every phase writes debug artifacts under `.cc-harness/sessions/<id>/traces/<phase>/`:

```text
prompt.txt
handoff.json
adapter_invocation.json
raw_transcript.jsonl
parsed_output.json
validation.json
timing.json
```

This is the debugging layer above `events.jsonl`: it shows what was asked, which adapter/model ran, what came back, how validation judged it, and how long it took.

## Local Learning Index

Every completed run appends a compact record to `.cc-harness/index/sessions.jsonl`. Failed or blocked runs also append to `.cc-harness/index/failures.jsonl` with a basic failure type such as `contract_violation`, `rate_limited`, `auth_blocked`, `loop_limit_reached`, `adapter_failure`, or `verification_failed`.

`cc-harness eval` mines this failure index into `.cc-harness/evals/generated/failures.jsonl`. `cc-harness improve --from-failures` clusters those failures into likely fix types (`prompt_patch`, `mode_patch`, `adapter_parser_patch`, `schema_patch`, `docs_patch`) and writes `.cc-harness/improvements/latest-plan.json`. It proposes patches; it does not auto-merge.

## Replay, Benchmark, Improve, Route

```bash
cc-harness replay <session-id>
cc-harness replay <session-id> --phase execute
cc-harness replay <session-id> --from-failure

cc-harness benchmark --write-report
cc-harness benchmark --live

cc-harness improve --from-failures
cc-harness route "fix the failing CLI option"
```

`replay` reconstructs phase prompts, handoffs, adapter invocation, raw transcript, parsed output, validation, timing, and verdict from the ledger.

`benchmark` produces deterministic harness-vs-raw comparison reports from the eval suite. `--live` is intentionally not faked: it reports blocked unless live Claude/Codex credentials and a real task corpus are present.

`route` maps task text to task type, mode, cognition pack, verifier type, artifact schema, and permission mode.

## Harness Quality Evals

Run:

```bash
cc-harness eval
cc-harness eval --json
```

The eval command writes `.cc-harness/evals/latest-report.json` and checks:

1. deterministic workflow behavior with the fake adapter,
2. contract enforcement and safe blocking,
3. loop retry behavior,
4. phase flight-recorder artifacts,
5. baseline comparisons showing where the harness blocks failures that a raw one-shot agent can miss,
6. failure-index mining into reusable eval case records.

## Commands

```bash
# Run a goal through the supported standard workflow
cc-harness run "<goal>" --mode standard [--model <model>] [--permission-mode safe|ask|trust|yolo] [--verbose] [--dry-run]

# Resume a committed non-terminal session
cc-harness resume <session-id>

# Inspect session state
cc-harness state <session-id>

# Adapter inspection and optional Codex prerequisite hint
cc-harness adapters list
cc-harness adapters list --permissions
cc-harness adapters enable codex

# Diagnostics
cc-harness doctor

# Harness quality evals
cc-harness eval [--json]

# Reconstruct a prior run
cc-harness replay <session-id> [--phase <phase>] [--from-failure]

# Compare deterministic raw-agent failure modes against harness behavior
cc-harness benchmark [--json] [--write-report] [--live]

# Convert indexed failures into eval cases and patch proposals
cc-harness improve --from-failures [--json]

# Classify a task before running
cc-harness route "<goal>" [--json]
```

The CLI accepts `--with <adapter>` set to `claude-code` (default) or `codex`; both are wired for execution. `fake` exists for internal deterministic tests only and is not a valid `--with` value on the CLI.

---

## Session Ledger

Every run writes to `.cc-harness/sessions/<session-id>/`:

```text
.cc-harness/sessions/<id>/
  plan.json          # committed workflow plan
  state.json         # current phase, status
  events.jsonl       # append-only event log
  outputs/           # per-phase structured outputs
  handoffs/          # model-to-model packets
  traces/            # prompt, invocation, transcript, parsed output, validation, timing
  artifacts/         # artifact manifest with existence, workspace, size, and SHA-256 checks
  verdict.json       # execution_status, verification_status, final_status
  summary.md         # human-readable summary
```

Sessions are local. No database or hosted service is required. Inspect or resume them with:

```bash
cc-harness state <session-id>
cc-harness resume <session-id>
```

---

## Register With Your Agent

After install, append the harness instructions to your agent's config file so it uses the harness automatically on complex tasks:

| Agent | File |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md` (global) or project `CLAUDE.md` |
| Codex | `AGENTS.md` in project root |
| Cursor / Windsurf | `.cursorrules` or project system prompt |

The instruction blocks:

- [`CLAUDE.md`](./CLAUDE.md) for Claude Code
- [`AGENTS.md`](./AGENTS.md) for Codex

Append the contents of the right file to your agent's instruction file.

---

## Legacy

The original Python harness (`harness.py`) is in [`legacy/`](./legacy/). Zero dependencies, requires only Python 3.7+.

```bash
curl -fsSL https://raw.githubusercontent.com/PLEE93/agent-harness/main/legacy/harness.py \
  -o ~/.agent-harness/harness.py
python ~/.agent-harness/harness.py '{"action": "state", "session_id": "test"}'
```

Same harness semantics. No CLI. No modes. Use it when you want a single Python file with no build step.

---

## About

Built as the execution backbone of the [Aurelius](https://github.com/PLEE93) autonomous agent system. Open-sourced for any terminal-based AI agent.
