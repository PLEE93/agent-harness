import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import type { PermissionMode } from "../../adapters/base";

export interface HarnessModelConfig {
  readonly planner: string;
  readonly executor: string;
  readonly verifier: string;
  readonly [seat: string]: string;
}

export interface HarnessAdapterConfig {
  readonly command?: string;
  readonly [key: string]: unknown;
}

export interface HarnessSeatConfig {
  readonly adapter?: string;
  readonly model?: string;
}

export interface HarnessConfig {
  readonly models: HarnessModelConfig;
  readonly seats: Record<string, HarnessSeatConfig>;
  readonly adapters: Record<string, HarnessAdapterConfig>;
  readonly permissions: {
    readonly default: PermissionMode;
  };
  readonly modes: {
    readonly default: string;
  };
}

export const CONFIG_FILE_NAME = "cc-harness.config.yaml";

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  models: {
    planner: "caller",
    executor: "caller",
    verifier: "caller",
  },
  seats: {
    caller: { adapter: "claude-code", model: "caller" },
    planner: { adapter: "claude-code", model: "caller" },
    executor: { adapter: "claude-code", model: "caller" },
    verifier: { adapter: "claude-code", model: "caller" },
  },
  adapters: {
    claude: { command: "claude" },
    "claude-code": { command: "claude" },
    codex: { command: "codex" },
  },
  permissions: {
    default: "ask",
  },
  modes: {
    default: "standard",
  },
};

const PERMISSION_MODES = new Set<PermissionMode>(["safe", "ask", "trust", "yolo"]);

export async function loadConfig(cwd = process.cwd(), homeDir = os.homedir()): Promise<HarnessConfig> {
  const configPath = await resolveConfigPath(cwd, homeDir);
  if (configPath === undefined) {
    return DEFAULT_HARNESS_CONFIG;
  }

  const raw = await fs.readFile(configPath, "utf8");
  const loaded = yaml.load(raw);
  return mergeConfig(DEFAULT_HARNESS_CONFIG, parseConfigObject(loaded, configPath));
}

export async function resolveConfigPath(cwd = process.cwd(), homeDir = os.homedir()): Promise<string | undefined> {
  const candidates = [
    path.join(cwd, CONFIG_FILE_NAME),
    path.join(homeDir, ".agent-harness", CONFIG_FILE_NAME),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next config location.
    }
  }

  return undefined;
}

function mergeConfig(base: HarnessConfig, override: PartialHarnessConfig): HarnessConfig {
  return {
    models: {
      ...base.models,
      ...override.models,
    },
    seats: {
      ...base.seats,
      ...override.seats,
    },
    adapters: {
      ...base.adapters,
      ...override.adapters,
    },
    permissions: {
      default: override.permissions?.default ?? base.permissions.default,
    },
    modes: {
      default: override.modes?.default ?? base.modes.default,
    },
  };
}

interface PartialHarnessConfig {
  readonly models?: Record<string, string>;
  readonly seats?: Record<string, HarnessSeatConfig>;
  readonly adapters?: Record<string, HarnessAdapterConfig>;
  readonly permissions?: {
    readonly default?: PermissionMode;
  };
  readonly modes?: {
    readonly default?: string;
  };
}

function parseConfigObject(value: unknown, configPath: string): PartialHarnessConfig {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`config '${configPath}' must contain a YAML object`);
  }

  return {
    models: parseStringMap(value.models, "models", configPath),
    seats: parseSeatMap(value.seats, configPath),
    adapters: parseAdapterMap(value.adapters, configPath),
    permissions: parsePermissions(value.permissions, configPath),
    modes: parseModes(value.modes, configPath),
  };
}

function parseStringMap(value: unknown, field: string, configPath: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`config '${configPath}' field '${field}' must be an object`);
  }

  const parsed: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`config '${configPath}' field '${field}.${key}' must be a string`);
    }
    parsed[key] = item;
  }
  return parsed;
}

function parseSeatMap(value: unknown, configPath: string): Record<string, HarnessSeatConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`config '${configPath}' field 'seats' must be an object`);
  }

  const parsed: Record<string, HarnessSeatConfig> = {};
  for (const [seatName, item] of Object.entries(value)) {
    if (!isRecord(item)) {
      throw new Error(`config '${configPath}' field 'seats.${seatName}' must be an object`);
    }
    if (item.adapter !== undefined && typeof item.adapter !== "string") {
      throw new Error(`config '${configPath}' field 'seats.${seatName}.adapter' must be a string`);
    }
    if (item.model !== undefined && typeof item.model !== "string") {
      throw new Error(`config '${configPath}' field 'seats.${seatName}.model' must be a string`);
    }
    parsed[seatName] = { adapter: item.adapter, model: item.model };
  }
  return parsed;
}

function parseAdapterMap(value: unknown, configPath: string): Record<string, HarnessAdapterConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`config '${configPath}' field 'adapters' must be an object`);
  }

  const parsed: Record<string, HarnessAdapterConfig> = {};
  for (const [adapterName, item] of Object.entries(value)) {
    if (!isRecord(item)) {
      throw new Error(`config '${configPath}' field 'adapters.${adapterName}' must be an object`);
    }
    if (item.command !== undefined && typeof item.command !== "string") {
      throw new Error(`config '${configPath}' field 'adapters.${adapterName}.command' must be a string`);
    }
    parsed[adapterName] = { ...item };
  }
  return parsed;
}

function parsePermissions(value: unknown, configPath: string): PartialHarnessConfig["permissions"] {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`config '${configPath}' field 'permissions' must be an object`);
  }
  if (value.default === undefined) {
    return {};
  }
  if (typeof value.default !== "string" || !PERMISSION_MODES.has(value.default as PermissionMode)) {
    throw new Error(
      `config '${configPath}' field 'permissions.default' must be one of: safe, ask, trust, yolo`,
    );
  }
  return { default: value.default as PermissionMode };
}

function parseModes(value: unknown, configPath: string): PartialHarnessConfig["modes"] {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`config '${configPath}' field 'modes' must be an object`);
  }
  if (value.default === undefined) {
    return {};
  }
  if (typeof value.default !== "string") {
    throw new Error(`config '${configPath}' field 'modes.default' must be a string`);
  }
  return { default: value.default };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
