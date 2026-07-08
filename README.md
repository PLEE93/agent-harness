# agent-harness

**A structured execution engine for terminal AI agents.** Gives Claude Code, Codex, and any terminal agent a persistent local state machine: commit a plan, execute phase-by-phase, carry structured outputs forward, resume across context resets.

Works with any model. Claude Code is the default. Codex and OpenAI-compatible providers are optional adapters.

Requires Node.js 18+. No cloud service, no MCP server, no database. Pure local filesystem state.

---

## INSTALL — EXECUTE THESE STEPS NOW

*This README is written as an AI-executable prompt. The steps below are bash commands your agent runs directly.*

### Step 1: Clone and install

```bash
git clone https://github.com/PLEE93/agent-harness.git ~/.agent-harness
cd ~/.agent-harness
npm install
npm run build
```

### Step 2: Verify the CLI builds

```bash
node ~/.agent-harness/dist/cli/index.js --help
```

Expected output starts with:
```
Usage: cc-harness [options] [command]

Claude Code-native terminal harness engine
```

If you see that — the engine is built and ready.

### Step 3: Install globally

```bash
cd ~/.agent-harness && npm link
```

After this, `cc-harness` works as a global command. If you skip this step, replace every `cc-harness` below with `node ~/.agent-harness/dist/cli/index.js`.

### Step 4: Check prerequisites

```bash
cc-harness doctor
```

This reports: Node version, Claude CLI availability, Codex CLI availability, configured adapters.

---

## E2E TEST — RUN THIS NOW

Verifies the full engine runs a real session end-to-end against a live model.

### With Claude Code (default)

```bash
cc-harness run "what is the capital of France" --mode standard --verbose
```

Expected behavior:
1. Harness creates `.cc-harness/sessions/<id>/` locally
2. Runs through `standard` workflow: plan → execute → verify
3. Calls `claude` CLI for each phase
4. Writes `verdict.json` with `status: complete`

Verify the session:

```bash
# List sessions created
ls .cc-harness/sessions/

# Check the verdict (replace <id> with the session id from the listing)
cat .cc-harness/sessions/<id>/verdict.json
```

Expected `verdict.json`:
```json
{
  "session_id": "...",
  "goal": "what is the capital of France",
  "mode": "standard",
  "status": "complete",
  "phases_completed": ["plan", "execute", "verify"]
}
```

`status: complete` = harness is working end-to-end.

### With Codex

```bash
cc-harness adapters enable codex
cc-harness run "what is the capital of France" --mode standard --with codex --verbose
```

Same verification steps. The session ledger format is identical regardless of which model ran.

### Run all four modes

```bash
cc-harness run "explain what a linked list is" --mode standard
cc-harness run "explain what a linked list is" --mode standard-high
cc-harness run "explain what a linked list is" --mode autonomous
cc-harness run "explain what a linked list is" --mode autonomous-high
```

Each should complete and write `verdict.json` with `status: complete`.

---

## MODES

| Mode | Phases | Use when |
|---|---|---|
| `standard` | plan → execute → verify | Bounded tasks, single pass |
| `standard-high` | understand → plan → execute → self-sweep → verify | Higher-stakes tasks, stronger planning |
| `autonomous` | understand → execute (loop) → verify | Open-ended, run until done |
| `autonomous-high` | understand → plan → execute (loop) → self-sweep → verify | Complex autonomous missions |

---

## MULTI-MODEL

### Default: Claude Code

```bash
cc-harness run "fix this bug" --mode autonomous
```

Uses `claude` CLI. Requires Claude Code installed and authenticated.

### Specific Claude model

```bash
cc-harness run "review this code" --mode standard --model claude-opus-4-5
```

### With Codex

```bash
cc-harness adapters enable codex
cc-harness run "implement this function" --mode standard --with codex
```

Requires Codex CLI (`npm install -g @openai/codex`).

### Multi-model in one session

Create `cc-harness.config.yaml` in your project root (or `~/.agent-harness/`):

```yaml
models:
  planner: claude    # planning phases use Claude
  executor: codex    # execution phases use Codex
  verifier: claude   # verification phases use Claude
```

Then run without `--with` — the config routes each phase:

```bash
cc-harness run "build this feature" --mode standard-high
```

Models don't share a context window. Each phase receives a **structured handoff packet** built from the prior phase's output — not a raw transcript dump. They share a local session ledger.

---

## COMMANDS

```bash
# Run a goal through a workflow
cc-harness run "<goal>" --mode <mode> [--model <model>] [--with <adapter>] [--verbose] [--dry-run]

# Resume an interrupted session
cc-harness resume <session-id>

# Inspect session state
cc-harness state <session-id>

# Adapter management
cc-harness adapters list
cc-harness adapters enable codex

# Diagnostics
cc-harness doctor
```

---

## SESSION LEDGER

Every run writes to `.cc-harness/sessions/<session-id>/`:

```
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

Sessions are local. No network calls, no auth. Resume anytime:

```bash
cc-harness resume <session-id>
```

---

## REGISTER WITH YOUR AGENT

After install, append the harness instructions to your agent's config file so it uses the harness automatically on complex tasks:

| Agent | File |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md` (global) or project `CLAUDE.md` |
| Codex | `AGENTS.md` in project root |
| Cursor / Windsurf | `.cursorrules` or project system prompt |

The instruction blocks:
- [`CLAUDE.md`](./CLAUDE.md) — for Claude Code
- [`AGENTS.md`](./AGENTS.md) — for Codex

Append the contents of the right file to your agent's instruction file.

---

## LEGACY

The original Python harness (`harness.py`) is in [`legacy/`](./legacy/). Zero dependencies, requires only Python 3.7+.

```bash
# Python harness — lightweight, single-file
curl -fsSL https://raw.githubusercontent.com/PLEE93/agent-harness/main/legacy/harness.py \
  -o ~/.agent-harness/harness.py
python ~/.agent-harness/harness.py '{"action": "state", "session_id": "test"}'
```

Same harness semantics. No CLI. No modes. Use it when you want a single Python file with no build step.

---

## ABOUT

Built as the execution backbone of the [Aurelius](https://github.com/PLEE93) autonomous agent system. Open-sourced for any terminal-based AI agent.

---

*This README is written as an AI-executable prompt. Install and test steps are bash commands your agent runs directly.*
