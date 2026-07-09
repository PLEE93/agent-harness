## HARNESS — Autonomous Execution State Machine

`cc-harness` is installed. Call it via bash:

```bash
cc-harness run "<goal>" --mode <mode> --with codex
```

If not globally linked: `node ~/.agent-harness/dist/cli/index.js run "<goal>" --mode <mode> --with codex`

---

### CLASSIFY EVERY INCOMING TASK

**TRIVIAL** — factual answer, definition, translation, yes/no, short explanation. Answer directly. No harness.

**COMPLEX** — build, design, implement, diagnose, fix, research, analyze, plan, deploy, investigate. Use harness.

When in doubt → COMPLEX.

---

### FOR COMPLEX TASKS: PICK A MODE

```bash
# Standard: plan → execute → verify
cc-harness run "<goal>" --mode standard --with codex

# Standard-High: stronger planning + self-sweep
cc-harness run "<goal>" --mode standard-high --with codex

# Autonomous: loop until done or blocked
cc-harness run "<goal>" --mode autonomous --with codex

# Autonomous-High: autonomous + stronger planning
cc-harness run "<goal>" --mode autonomous-high --with codex
```

---

### MULTI-MODEL (Claude planning + Codex execution)

Create `cc-harness.config.yaml` in project root:

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

Then run without `--with` so the config routes each phase seat to its adapter and model:
```bash
cc-harness run "<goal>" --mode standard-high
```

---

### SESSION MANAGEMENT

```bash
cc-harness resume <session-id>   # resume after interruption
cc-harness state <session-id>    # check current phase
cc-harness doctor                # check prerequisites
```

Sessions at `.cc-harness/sessions/<id>/` — local, resumable, no cloud.

---

### RULES

- COMPLEX task → use harness every time.
- Do not declare done until `verdict.json` shows `status: complete`.
- Failure in any phase: diagnose root cause before retrying.
- Sessions survive context resets — `cc-harness resume <id>` picks up mid-phase.
