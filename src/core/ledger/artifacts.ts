import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ArtifactManifestEntry } from "./verdict";

export interface ArtifactValidationResult {
  readonly valid: boolean;
  readonly manifest: ArtifactManifestEntry[];
  readonly failures: string[];
}

export async function validateArtifacts(workspaceRoot: string, artifacts: string[]): Promise<ArtifactValidationResult> {
  const uniqueArtifacts = Array.from(new Set(artifacts));
  const manifest = await Promise.all(uniqueArtifacts.map((artifact) => inspectArtifact(workspaceRoot, artifact)));
  const failures = manifest.flatMap((entry) => {
    const result = [];
    if (!entry.inside_workspace) {
      result.push(`artifact '${entry.path}' is outside the workspace`);
    }
    if (!entry.exists) {
      result.push(`artifact '${entry.path}' does not exist`);
    }
    if (entry.error !== undefined) {
      result.push(`artifact '${entry.path}' could not be inspected: ${entry.error}`);
    }
    return result;
  });
  return { valid: failures.length === 0, manifest, failures };
}

async function inspectArtifact(workspaceRoot: string, artifactPath: string): Promise<ArtifactManifestEntry> {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedArtifact = path.resolve(workspaceRoot, artifactPath);
  const insideWorkspace = resolvedArtifact === resolvedWorkspace || resolvedArtifact.startsWith(`${resolvedWorkspace}${path.sep}`);

  if (!insideWorkspace) {
    return { path: artifactPath, exists: false, inside_workspace: false };
  }

  try {
    const stat = await fs.stat(resolvedArtifact);
    if (!stat.isFile()) {
      return {
        path: artifactPath,
        exists: true,
        inside_workspace: true,
        size_bytes: stat.size,
        error: "not a regular file",
      };
    }
    const content = await fs.readFile(resolvedArtifact);
    return {
      path: artifactPath,
      exists: true,
      inside_workspace: true,
      size_bytes: stat.size,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { path: artifactPath, exists: false, inside_workspace: true };
    }
    return {
      path: artifactPath,
      exists: false,
      inside_workspace: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
