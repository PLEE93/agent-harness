import { promises as fs } from "node:fs";
import path from "node:path";

export type EventLevel = "info" | "warning" | "error";

export interface LedgerEvent {
  readonly timestamp: string;
  readonly level: EventLevel;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export type LedgerEventInput = Omit<LedgerEvent, "timestamp"> & {
  readonly timestamp?: string;
};

export async function appendEvent(eventsPath: string, event: LedgerEventInput): Promise<LedgerEvent> {
  const committed: LedgerEvent = {
    timestamp: event.timestamp ?? new Date().toISOString(),
    level: event.level,
    type: event.type,
    data: event.data,
  };
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, `${JSON.stringify(committed)}\n`, "utf8");
  return committed;
}

export async function readEvents(eventsPath: string): Promise<LedgerEvent[]> {
  const raw = await fs.readFile(eventsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerEvent);
}
