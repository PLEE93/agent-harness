import type { OutputContract } from "../contracts/types";

export interface OutputValidationResult {
  readonly valid: boolean;
  readonly failures: string[];
}

export function validatePhaseOutput(contract: OutputContract | undefined, output: unknown): OutputValidationResult {
  if (contract === undefined) {
    return { valid: true, failures: [] };
  }
  if (!isRecord(output)) {
    return {
      valid: false,
      failures: ["phase output must be a JSON object matching the output_contract"],
    };
  }

  const failures = Object.entries(contract).flatMap(([field, shape]) =>
    validateField(output[field], shape, field),
  );
  return { valid: failures.length === 0, failures };
}

function validateField(value: unknown, shape: unknown, path: string): string[] {
  if (value === undefined) {
    return [`missing required key '${path}'`];
  }

  if (typeof shape === "string") {
    return validateStringShape(value, shape, path);
  }

  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) {
      return [`key '${path}' must be an array shaped as ${JSON.stringify(shape)}`];
    }
    if (shape.length === 0) {
      return [];
    }
    return value.flatMap((item, index) => validateArrayItem(item, shape[0], `${path}[${index}]`));
  }

  if (isRecord(shape)) {
    if (!isRecord(value)) {
      return [`key '${path}' must be an object`];
    }
    return Object.entries(shape).flatMap(([childKey, childShape]) =>
      validateField(value[childKey], childShape, `${path}.${childKey}`),
    );
  }

  return [];
}

function validateStringShape(value: unknown, shape: string, path: string): string[] {
  if (shape.includes("|")) {
    if (typeof value !== "string") {
      return [`key '${path}' must be one of ${shape}, received ${typeof value}`];
    }
    const allowed = shape.split("|").map((item) => item.trim()).filter(Boolean);
    return allowed.includes(value) ? [] : [`key '${path}' must be one of ${allowed.join(", ")}, received '${value}'`];
  }

  if (shape === "string") {
    return typeof value === "string" ? [] : [`key '${path}' must be a string, received ${typeof value}`];
  }
  if (shape === "object") {
    return isRecord(value) ? [] : [`key '${path}' must be an object`];
  }
  if (shape === "number") {
    return typeof value === "number" ? [] : [`key '${path}' must be a number, received ${typeof value}`];
  }
  if (shape === "boolean") {
    return typeof value === "boolean" ? [] : [`key '${path}' must be a boolean, received ${typeof value}`];
  }

  return [];
}

function validateArrayItem(value: unknown, shape: unknown, path: string): string[] {
  if (shape === "string") {
    return typeof value === "string" ? [] : [`key '${path}' must be a string, received ${typeof value}`];
  }
  if (shape === "object") {
    return isRecord(value) ? [] : [`key '${path}' must be an object`];
  }
  return validateField(value, shape, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
