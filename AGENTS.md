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
# Standard: Aurelius standard shape, opus/codex/sonnet role routing
cc-harness run "<goal>" --mode standard --with codex

# Standard-High: same standard phase shape; fable owns orient/plan
cc-harness run "<goal>" --mode standard-high --with codex

# Autonomous: same selected caller model runs every phase
cc-harness run "<goal>" --mode autonomous --with codex

# Autonomous-High: same autonomous phase shape; fable owns understand/plan
cc-harness run "<goal>" --mode autonomous-high --with codex
```

---

### MODEL ROUTING

High modes mean model routing, not extra phases. Literal phase models such as `fable`, `opus`, `codex-5.5`, and `sonnet` are preserved unless config aliases override them.

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
cc-harness eval                  # run deterministic harness-quality evals
cc-harness replay <session-id>   # reconstruct prompts, handoffs, outputs, validation, and verdict
cc-harness benchmark             # compare deterministic raw-agent failure modes against harness behavior
cc-harness improve --from-failures # propose patches from indexed failures
cc-harness route "<goal>"        # classify task type, mode, verifier, artifact schema, permissions
```

Sessions at `.cc-harness/sessions/<id>/` — local, resumable, no cloud.

---

### RULES

- COMPLEX task → use harness every time.
- Do not declare done until `verdict.json` shows `execution_status: complete`, `verification_status: pass`, and `final_status: success`.
- For harness changes, also run `cc-harness eval`; it writes deterministic quality evidence and mined failure cases under `.cc-harness/evals/`.
- Use `cc-harness adapters list --permissions` before making permission claims; Claude Code non-yolo modes are delegated to Claude CLI behavior, not harness sandbox guarantees.
- Failure in any phase: diagnose root cause before retrying.
- Sessions survive context resets — `cc-harness resume <id>` picks up mid-phase.
