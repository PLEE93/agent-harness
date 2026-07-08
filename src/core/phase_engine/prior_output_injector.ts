import path from "node:path";
import type { PlanFile } from "../ledger/plan";
import type { StateFile } from "../ledger/state";
import type { SessionRecord } from "../ledger/session";
import { readOutput, writeJsonFile } from "../ledger/session";

export interface HandoffPacket {
  readonly from_phase: string;
  readonly to_phase: string;
  readonly session_id: string;
  readonly goal: string;
  readonly mode: string;
  readonly prior_output: unknown;
  readonly artifacts_available: string[];
  readonly open_questions: string[];
}

export interface BuildHandoffPacketParams {
  readonly session: SessionRecord;
  readonly plan: PlanFile;
  readonly state: StateFile;
  readonly fromPhase: string;
  readonly toPhase: string;
}

export async function buildHandoffPacket(params: BuildHandoffPacketParams): Promise<HandoffPacket> {
  const priorOutput = await readOutput<unknown>(params.session, params.fromPhase);
  return {
    from_phase: params.fromPhase,
    to_phase: params.toPhase,
    session_id: params.plan.session_id,
    goal: params.plan.goal,
    mode: params.plan.mode,
    prior_output: priorOutput,
    artifacts_available: extractArtifacts(priorOutput),
    open_questions: params.state.open_questions,
  };
}

export async function writeHandoffPacket(session: SessionRecord, packet: HandoffPacket): Promise<string> {
  const handoffPath = path.join(session.paths.handoffs, `${packet.from_phase}-to-${packet.to_phase}.json`);
  await writeJsonFile(handoffPath, packet);
  return handoffPath;
}

function extractArtifacts(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.artifacts)) {
    return [];
  }
  return value.artifacts.filter((artifact): artifact is string => typeof artifact === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
