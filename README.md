# agent-harness

**A structured execution engine for terminal AI agents.** Gives Claude Code, Codex, and any terminal agent a persistent local state machine: commit a plan, execute phase-by-phase, carry structured outputs forward, and resume across context resets.

The thesis is simple: terminal agents need a durable execution layer outside any one context window. agent-harness turns a goal into a local session ledger with explicit phases, structured handoffs, output contracts, and a final verdict.

Requires Node.js 18+. No cloud service, no MCP server, no database. Pure local filesystem state.

---

## What Works Today (v0.1.0)

- `standard` mode (`plan -> execute -> verify`) from bundled `modes/standard.yaml`, live-verified end-to-end
- Claude Code adapter via the local `claude` CLI
- Codex adapter via the local `codex` CLI (`cc-harness run --with codex`); PATH availability is checked at runtime and a missing CLI fails honestly instead of crashing
- Local session ledger: `plan.json`, `state.json`, `events.jsonl`, phase outputs, handoffs, and `verdict.json`
- Output contracts and structured handoff packets between phases
- Config file loading from `cc-harness.config.yaml` (falls back to `~/.agent-harness/cc-harness.config.yaml`, then built-in defaults) for default mode, default permission mode, and per-phase model aliases
- `standard-high`, `autonomous`, and `autonomous-high` mode YAMLs are bundled in `modes/` and `src/modes/` and resolve via `--mode <name>` (package-relative resolution, verified from a directory outside the project); the engine executes phase types generically, so all four modes run through the same engine/config/adapter wiring as `standard`
- Deterministic JavaScript test suite: `npm test` (14 tests, fake adapter only, no live CLI calls)
- `cc-harness run "<goal>" --mode standard`
- `cc-harness run "<goal>" --mode <any bundled mode> --dry-run`
- `cc-harness doctor`
- `cc-harness state <session-id>`
- `cc-harness resume <session-id>` for committed non-terminal sessions
- `cc-harness adapters list`
- `cc-harness adapters enable codex` as a prerequisite check and usage hint

## In Progress

- Live, end-to-end verified runs of `standard-high`, `autonomous`, and `autonomous-high` against a real Claude/Codex model — the YAML, engine, config, and CLI wiring is in place, but a full multi-turn run (including `self_sweep` and `loop_until` phases) has not been exercised outside this repo's deterministic, live-CLI-free test gate
- Per-phase model alias overrides in a live run — `planner`/`executor`/`verifier` seats resolve through `cc-harness.config.yaml`, but multi-model routing has only been verified at the source/config level, not in a live multi-model session
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

This verifies the current supported path: the `standard` workflow against the local Claude Code CLI.

```bash
cc-harness run "what is the capital of France" --mode standard --verbose
```

Expected behavior:

1. Harness creates `.cc-harness/sessions/<id>/` in the current project.
2. Runs the `standard` workflow: `plan -> execute -> verify`.
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
  "status": "complete",
  "phases_completed": ["plan", "execute", "verify"]
}
```

`status: complete` means the supported harness path completed end-to-end.

---

## Modes

| Mode | Status | Phases |
|---|---|---|
| `standard` | Works today, live-verified | `plan -> execute -> verify` |
| `standard-high` | Bundled + wired, not live-verified | `understand -> plan -> execute -> self-sweep -> verify` |
| `autonomous` | Bundled + wired, not live-verified | `understand -> execute (loop) -> verify` |
| `autonomous-high` | Bundled + wired, not live-verified | `understand -> plan -> execute (loop) -> self-sweep -> verify` |

All four modes are bundled in `modes/` and `src/modes/` and resolve via package-relative path lookup (verified from outside the project directory). `standard` is the only mode whose full phase sequence has been exercised end-to-end against a live model; the other three run through the same engine, config, and CLI wiring but have not yet been run live in this repo's deterministic gate (which forbids live CLI calls). Project-level overrides can be placed in `.cc-harness/modes/<mode>.yaml`.

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

---

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
cc-harness adapters enable codex

# Diagnostics
cc-harness doctor
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
  artifacts/         # files produced during the run
  verdict.json       # final structured result
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
