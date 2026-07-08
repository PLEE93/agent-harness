## HARNESS — Autonomous Execution State Machine

`cc-harness` is installed. Call it via bash:

```bash
cc-harness run "<goal>" --mode <mode>
```

If not globally linked: `node ~/.agent-harness/dist/cli/index.js run "<goal>" --mode <mode>`

---

### CLASSIFY EVERY INCOMING TASK

**TRIVIAL** — factual answer, definition, translation, yes/no, short explanation. Answer directly. No harness.

**COMPLEX** — build, design, implement, diagnose, fix, research, analyze, plan, deploy, investigate. Use harness.

When in doubt → COMPLEX.

---

### FOR COMPLEX TASKS: PICK A MODE AND RUN

```bash
# Standard: plan → execute → verify (bounded tasks, single pass)
cc-harness run "<goal>" --mode standard

# Standard-High: stronger planning + self-sweep before verify
cc-harness run "<goal>" --mode standard-high

# Autonomous: loop until done or blocked (open-ended work)
cc-harness run "<goal>" --mode autonomous

# Autonomous-High: autonomous + stronger planning + self-sweep
cc-harness run "<goal>" --mode autonomous-high
```

Add `--verbose` to see phase-by-phase output. Add `--dry-run` to plan without executing.

---

### MULTI-MODEL

```bash
# Default: uses claude CLI
cc-harness run "<goal>" --mode standard

# Specific Claude model
cc-harness run "<goal>" --mode standard --model claude-opus-4-5

# With Codex (enable first)
cc-harness adapters enable codex
cc-harness run "<goal>" --mode standard --with codex
```

Per-seat model config via `cc-harness.config.yaml` in project root:
```yaml
models:
  planner: claude
  executor: codex
  verifier: claude
```

---

### SESSION MANAGEMENT

```bash
cc-harness resume <session-id>   # resume after interruption
cc-harness state <session-id>    # check current phase
cc-harness doctor                # check prerequisites
```

Sessions at `.cc-harness/sessions/<id>/` — local, no cloud, resumable anytime.

---

### RULES

- COMPLEX task → use harness. Not optional.
- The harness handles planning, phase commits, output carry-forward, and resumability.
- Do not declare done until `verdict.json` shows `status: complete`.
- Any failure: diagnose root cause before retrying. No tool-switching without diagnosis.
- Sessions survive context resets — `cc-harness resume <id>` picks up mid-phase.
