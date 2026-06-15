"""
harness.py — Autonomous Execution State Machine for AI Agents

About:
  Backs structured plan-commit + phase execution for any terminal-based AI agent.
  When a task is COMPLEX, the agent commits a plan before working, executes
  phase-by-phase with context isolation, and closes each phase with structured
  output. Makes AI work auditable, resumable, and measurably higher quality.

State storage:
  ~/.agent-harness/sessions/{session_id}/  (default)
  Override: HARNESS_DATA=/your/path python harness.py ...

CLI usage:
  python harness.py '{"action": "commit_plan", "session_id": "my-task", ...}'
  echo '{"action": "state", "session_id": "my-task"}' | python harness.py

Actions:
  classify           — record TRIVIAL/COMPLEX gate decision
  commit_plan        — validate + write the execution plan, bind the session
  commit_step_output — finalize a phase, advance to next
  state              — return plan + current phase + status + prior outputs
  reset              — archive session (new task or explicit reset)
  phase_types        — list valid phase type definitions

Each step in commit_plan requires:
  name (slug, max 60 chars), type (phase type key), objective (one sentence),
  output_contract (what structured data you emit when closing the phase)

Optional per step:
  context_load (list), tools_allowed (list), max_tool_calls (int, default 12)
"""
import json
import os
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

# Data path: default ~/.agent-harness/, override with HARNESS_DATA env var
HARNESS_ROOT = Path(os.getenv("HARNESS_DATA", str(Path.home() / ".agent-harness")))
SESSIONS_ROOT = HARNESS_ROOT / "sessions"

VALID_PHASE_TYPES = {
    "understand", "research", "plan", "execute",
    "test", "red_team", "iterate", "analyze", "synthesize",
}
VALID_CLASSIFICATIONS = {"TRIVIAL", "COMPLEX"}
VALID_NEXT_ACTIONS = {"continue", "revise", "done"}

MAX_STEPS_PER_PLAN = 9
MAX_REVISIONS_PER_PLAN = 1


def _session_dir(session_id: str) -> Path:
    if not session_id or "/" in session_id or ".." in session_id:
        raise ValueError(f"invalid session_id: {session_id!r}")
    d = SESSIONS_ROOT / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


# ---------- ACTIONS ----------


def _classify(session_id: str, classification: str, reason: str) -> Dict[str, Any]:
    if classification not in VALID_CLASSIFICATIONS:
        return {"status": "error", "error": f"classification must be TRIVIAL or COMPLEX, got {classification!r}"}
    sdir = _session_dir(session_id)
    state = _read_json(sdir / "state.json") or {}
    state.update({
        "session_id": session_id,
        "classification": classification,
        "classification_reason": reason or "",
        "classified_at": time.time(),
        "status": "classified" if classification == "TRIVIAL" else "awaiting_plan",
    })
    _write_json(sdir / "state.json", state)
    return {"status": "success", "classification": classification, "state": state}


def _validate_step(step: Dict[str, Any], idx: int) -> Optional[str]:
    required = ["name", "type", "objective", "output_contract"]
    for f in required:
        if not step.get(f):
            return f"step {idx} missing required field '{f}'"
    if step["type"] not in VALID_PHASE_TYPES:
        return f"step {idx} type {step['type']!r} not in {sorted(VALID_PHASE_TYPES)}"
    if len(step.get("name", "")) > 60:
        return f"step {idx} name too long (max 60 chars)"
    for opt_list in ("context_load", "tools_allowed"):
        v = step.get(opt_list, [])
        if v is not None and not isinstance(v, list):
            return f"step {idx} {opt_list} must be a list"
    mtc = step.get("max_tool_calls", 12)
    if not isinstance(mtc, int) or mtc < 1 or mtc > 100:
        return f"step {idx} max_tool_calls must be int in [1, 100]"
    return None


def _commit_plan(session_id: str, steps: List[Dict[str, Any]], mission_summary: str = "") -> Dict[str, Any]:
    if not isinstance(steps, list) or not steps:
        return {"status": "error", "error": "steps must be a non-empty list"}
    if len(steps) > MAX_STEPS_PER_PLAN:
        return {"status": "error", "error": f"plan has {len(steps)} steps; max is {MAX_STEPS_PER_PLAN}"}
    names = set()
    for i, step in enumerate(steps):
        err = _validate_step(step, i)
        if err:
            return {"status": "error", "error": err}
        if step["name"] in names:
            return {"status": "error", "error": f"duplicate step name: {step['name']}"}
        names.add(step["name"])

    sdir = _session_dir(session_id)
    state = _read_json(sdir / "state.json") or {}
    if state.get("classification") != "COMPLEX":
        state["classification"] = "COMPLEX"
        state["classification_reason"] = state.get("classification_reason") or "implied by plan commit"

    plan = {
        "session_id": session_id,
        "mission_summary": mission_summary or "",
        "steps": steps,
        "committed_at": time.time(),
        "revision_count": state.get("revision_count", 0),
    }
    _write_json(sdir / "plan.json", plan)

    state.update({
        "status": "executing",
        "current_phase_index": 0,
        "current_phase_name": steps[0]["name"],
        "total_phases": len(steps),
        "plan_committed_at": time.time(),
    })
    _write_json(sdir / "state.json", state)
    _append_event(sdir, {
        "type": "phase_update",
        "ts": time.time(),
        "current_phase_index": 0,
        "current_phase_name": steps[0]["name"],
        "current_phase_type": steps[0]["type"],
        "total_phases": len(steps),
        "status": "executing",
    })
    return {"status": "success", "plan": plan, "state": state}


def _append_event(sdir: Path, event: Dict[str, Any]) -> None:
    events_path = sdir / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def _commit_step_output(session_id: str, step_name: str, output: Any, next_action: str = "continue") -> Dict[str, Any]:
    if next_action not in VALID_NEXT_ACTIONS:
        return {"status": "error", "error": f"next_action must be one of {sorted(VALID_NEXT_ACTIONS)}, got {next_action!r}"}

    sdir = _session_dir(session_id)
    plan = _read_json(sdir / "plan.json")
    state = _read_json(sdir / "state.json")
    if not plan or not state:
        return {"status": "error", "error": "no committed plan for this session"}

    steps = plan["steps"]
    idx = state.get("current_phase_index", 0)
    if idx >= len(steps):
        return {"status": "error", "error": "all phases already executed; call reset for a new mission"}
    if steps[idx]["name"] != step_name:
        return {"status": "error", "error": f"expected step {steps[idx]['name']!r}, got {step_name!r}"}

    step_output_path = sdir / f"step-{idx:02d}-output.json"
    _write_json(step_output_path, {
        "step_name": step_name,
        "step_index": idx,
        "step_type": steps[idx]["type"],
        "output": output,
        "next_action": next_action,
        "committed_at": time.time(),
    })

    if next_action == "revise":
        rc = plan.get("revision_count", 0)
        if rc >= MAX_REVISIONS_PER_PLAN:
            return {"status": "error", "error": f"revision limit hit ({MAX_REVISIONS_PER_PLAN}); escalate or finish current plan"}
        state["status"] = "awaiting_revision"
        plan["revision_count"] = rc + 1
        _write_json(sdir / "plan.json", plan)
        _write_json(sdir / "state.json", state)
        _append_event(sdir, {"type": "phase_update", "ts": time.time(), "status": "awaiting_revision",
                             "current_phase_index": idx, "current_phase_name": step_name})
        return {"status": "success", "next": "revise", "state": state}

    if next_action == "done":
        state["status"] = "completed"
        state["completed_at"] = time.time()
        _write_json(sdir / "state.json", state)
        _append_event(sdir, {"type": "phase_update", "ts": time.time(), "status": "completed",
                             "current_phase_index": idx, "current_phase_name": step_name})
        return {"status": "success", "next": "done", "state": state}

    # continue: advance
    new_idx = idx + 1
    if new_idx >= len(steps):
        state["status"] = "completed"
        state["completed_at"] = time.time()
        _write_json(sdir / "state.json", state)
        _append_event(sdir, {"type": "phase_update", "ts": time.time(), "status": "completed",
                             "current_phase_index": idx, "current_phase_name": step_name})
        return {"status": "success", "next": "done_implicit", "state": state}

    state["current_phase_index"] = new_idx
    state["current_phase_name"] = steps[new_idx]["name"]
    state["last_advance_at"] = time.time()
    _write_json(sdir / "state.json", state)
    _append_event(sdir, {
        "type": "phase_update",
        "ts": time.time(),
        "current_phase_index": new_idx,
        "current_phase_name": steps[new_idx]["name"],
        "current_phase_type": steps[new_idx]["type"],
        "total_phases": len(steps),
        "status": "executing",
    })
    return {"status": "success", "next": "continue", "state": state, "next_phase": steps[new_idx]}


def _state(session_id: str) -> Dict[str, Any]:
    sdir = _session_dir(session_id)
    plan = _read_json(sdir / "plan.json")
    state = _read_json(sdir / "state.json")
    outputs = []
    if plan:
        idx = state.get("current_phase_index", 0) if state else 0
        for i in range(idx):
            so = _read_json(sdir / f"step-{i:02d}-output.json")
            if so:
                outputs.append({
                    "step_name": so.get("step_name"),
                    "step_type": so.get("step_type"),
                    "output": so.get("output"),
                })
    return {"status": "success", "plan": plan, "state": state, "prior_outputs": outputs}


def _reset(session_id: str) -> Dict[str, Any]:
    sdir = _session_dir(session_id)
    if any(sdir.iterdir()):
        archive = sdir.parent / f"{session_id}.archived.{int(time.time())}"
        sdir.rename(archive)
        _session_dir(session_id)  # recreate empty
    return {"status": "success", "reset": True}


def _phase_types() -> Dict[str, Any]:
    return {
        "status": "success",
        "phase_types": {
            "understand": "calibrate scope, lock done-criteria and failure modes",
            "research": "gather external knowledge, frameworks, patterns, prior art",
            "plan": "concrete architecture, file list, sequence, risks, tradeoffs",
            "execute": "build, write, implement, deploy, produce",
            "test": "verify every done-criterion with evidence; no curl-only checks",
            "red_team": "actively try to break the deliverable; adversarial pass",
            "iterate": "root-cause diagnose, replan on failure; max 3 cycles",
            "analyze": "deep reasoning pass; for analysis missions with no build phase",
            "synthesize": "combine prior phase outputs into the user-facing deliverable",
        },
    }


# ---------- DISPATCH ----------


def execute(params: Dict[str, Any]) -> Dict[str, Any]:
    """Entrypoint for both CLI and programmatic use."""
    action = params.get("action") or params.get("op") or ""
    session_id = params.get("session_id") or ""

    if action == "classify":
        return _classify(session_id, params.get("classification", ""), params.get("reason", ""))
    if action == "commit_plan":
        return _commit_plan(session_id, params.get("steps", []), params.get("mission_summary", ""))
    if action == "commit_step_output":
        return _commit_step_output(
            session_id,
            params.get("step_name", ""),
            params.get("output"),
            params.get("next_action", "continue"),
        )
    if action == "state":
        return _state(session_id)
    if action == "reset":
        return _reset(session_id)
    if action == "phase_types":
        return _phase_types()

    return {
        "status": "error",
        "error": f"unknown action {action!r}; valid: classify, commit_plan, commit_step_output, state, reset, phase_types",
    }


# ---------- CLI ----------


if __name__ == "__main__":
    import sys

    try:
        if len(sys.argv) > 1:
            raw = sys.argv[1]
        else:
            raw = sys.stdin.read().strip()
        if not raw:
            print(json.dumps({"status": "error", "error": "no input; pass JSON as arg or stdin"}))
            sys.exit(1)
        params = json.loads(raw)
        result = execute(params)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        sys.exit(0 if result.get("status") == "success" else 1)
    except json.JSONDecodeError as e:
        print(json.dumps({"status": "error", "error": f"invalid JSON: {e}"}))
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)
