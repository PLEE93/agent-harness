import type { PermissionMode } from "./base";

export interface AdapterPermissionCapability {
  readonly adapter: string;
  readonly mode: PermissionMode;
  readonly filesystem: "read-only" | "workspace-write" | "full" | "adapter-default";
  readonly network: "off" | "ask" | "on" | "adapter-default";
  readonly approval: "never" | "on-write" | "on-risk" | "always" | "adapter-default";
  readonly destructive_actions: "deny" | "ask" | "allow" | "adapter-default";
  readonly enforced_by_harness: boolean;
  readonly note: string;
}

const MODES: PermissionMode[] = ["safe", "ask", "trust", "yolo"];

export function permissionCapabilityMatrix(adapter: string): AdapterPermissionCapability[] {
  return MODES.map((mode) => permissionCapability(adapter, mode));
}

export function permissionCapability(adapter: string, mode: PermissionMode): AdapterPermissionCapability {
  if (adapter === "codex") {
    return codexCapability(mode);
  }
  if (adapter === "claude" || adapter === "claude-code") {
    return claudeCapability(mode);
  }
  return {
    adapter,
    mode,
    filesystem: "adapter-default",
    network: "adapter-default",
    approval: "adapter-default",
    destructive_actions: "adapter-default",
    enforced_by_harness: false,
    note: "No harness-defined permission mapping for this adapter.",
  };
}

function codexCapability(mode: PermissionMode): AdapterPermissionCapability {
  if (mode === "safe") {
    return {
      adapter: "codex",
      mode,
      filesystem: "read-only",
      network: "ask",
      approval: "always",
      destructive_actions: "deny",
      enforced_by_harness: true,
      note: "Mapped to Codex read-only sandbox with approvals required.",
    };
  }
  if (mode === "ask") {
    return {
      adapter: "codex",
      mode,
      filesystem: "workspace-write",
      network: "ask",
      approval: "on-risk",
      destructive_actions: "ask",
      enforced_by_harness: true,
      note: "Mapped to Codex workspace-write sandbox with on-request approval.",
    };
  }
  if (mode === "trust") {
    return {
      adapter: "codex",
      mode,
      filesystem: "workspace-write",
      network: "on",
      approval: "never",
      destructive_actions: "ask",
      enforced_by_harness: true,
      note: "Mapped to Codex workspace-write with approvals disabled.",
    };
  }
  return {
    adapter: "codex",
    mode,
    filesystem: "full",
    network: "on",
    approval: "never",
    destructive_actions: "allow",
    enforced_by_harness: true,
    note: "Dangerous bypass mode.",
  };
}

function claudeCapability(mode: PermissionMode): AdapterPermissionCapability {
  if (mode === "yolo") {
    return {
      adapter: "claude-code",
      mode,
      filesystem: "full",
      network: "adapter-default",
      approval: "never",
      destructive_actions: "allow",
      enforced_by_harness: true,
      note: "Mapped to Claude Code dangerous skip-permissions flag.",
    };
  }
  return {
    adapter: "claude-code",
    mode,
    filesystem: "adapter-default",
    network: "adapter-default",
    approval: "adapter-default",
    destructive_actions: mode === "safe" ? "ask" : "adapter-default",
    enforced_by_harness: false,
    note: "Claude Code non-yolo permission behavior is delegated to the Claude CLI; cc-harness does not claim sandbox equivalence.",
  };
}
