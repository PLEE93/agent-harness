export type ModelSeat = string;

export interface ModelSeatResolution {
  readonly requested: ModelSeat;
  readonly resolved: string;
  readonly source: "caller" | "alias" | "literal";
}

export function resolveModelSeat(
  seat: ModelSeat,
  callerModel: string,
  aliases: Record<string, string> = {},
): ModelSeatResolution {
  if (seat === "caller") {
    return { requested: seat, resolved: callerModel, source: "caller" };
  }

  const alias = aliases[seat];
  if (alias !== undefined && alias.trim().length > 0) {
    if (alias === "caller") {
      return { requested: seat, resolved: callerModel, source: "caller" };
    }
    return { requested: seat, resolved: alias, source: "alias" };
  }

  return { requested: seat, resolved: callerModel, source: "caller" };
}
