## HARNESS — Autonomous Execution State Machine

harness.py is installed at `~/.agent-harness/harness.py`.
Call it via bash with JSON params:

```bash
python ~/.agent-harness/harness.py '<JSON>'
```

### CLASSIFY EVERY INCOMING TASK

**TRIVIAL** — factual answer, definition, translation, yes/no, short explanation. Answer directly. No harness.

**COMPLEX** — build, design, implement, diagnose, fix, research, analyze, plan, deploy, investigate. Use harness.

When in doubt → COMPLEX.

### FOR COMPLEX TASKS: COMMIT THE PLAN FIRST (before any other action)

```bash
python ~/.agent-harness/harness.py '{
  "action": "commit_plan",
  "session_id": "task-slug-YYYYMMDD",
  "mission_summary": "one sentence: what the user observably gets when done",
  "steps": [
    {
      "name": "understand_scope",
      "type": "understand",
      "objective": "lock done-criteria and failure modes",
      "output_contract": "{scope, done_criteria, risks}",
      "max_tool_calls": 6
    },
    {
      "name": "execute_build",
      "type": "execute",
      "objective": "implement the solution",
      "output_contract": "{files_written, result}",
      "max_tool_calls": 20
    },
    {
      "name": "verify",
      "type": "test",
      "objective": "confirm every done-criterion is met with evidence",
      "output_contract": "{criteria_checked, pass_fail, evidence}",
      "max_tool_calls": 8
    }
  ]
}'
```

### CLOSE EACH PHASE WHEN DONE

```bash
python ~/.agent-harness/harness.py '{
  "action": "commit_step_output",
  "session_id": "task-slug-YYYYMMDD",
  "step_name": "understand_scope",
  "output": {
    "scope": "...",
    "done_criteria": ["criterion 1", "criterion 2"],
    "risks": ["risk 1"]
  },
  "next_action": "continue"
}'
```

`next_action`: `continue` (advance) | `revise` (replan) | `done` (mission complete)

### PHASE TYPES

`understand` `research` `plan` `execute` `test` `red_team` `iterate` `analyze` `synthesize`

### STEP SCHEMA (required fields)

- `name` — slug, max 60 chars, unique in plan
- `type` — one of the types above
- `objective` — one sentence
- `output_contract` — what structured data you emit when closing

Optional: `context_load` (list), `tools_allowed` (list), `max_tool_calls` (int, default 12)

### RULES

- Max 9 steps per plan
- DO NOT declare done until every done-criterion from `understand` is verified in a `test` phase
- Any failure: diagnose root cause before switching tools or retrying
- Only `output` from each closed phase carries to the next; raw intermediate state is released
- Reset a session: `python ~/.agent-harness/harness.py '{"action": "reset", "session_id": "..."}'`
