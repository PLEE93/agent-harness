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
    if (isSchemaShape(shape)) {
      return validateSchemaShape(value, shape, path);
    }
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

interface SchemaShape extends Record<string, unknown> {
  readonly type?: unknown;
  readonly required?: unknown;
  readonly additionalProperties?: unknown;
  readonly properties?: unknown;
  readonly items?: unknown;
  readonly enum?: unknown;
  readonly minLength?: unknown;
  readonly maxLength?: unknown;
}

function isSchemaShape(shape: Record<string, unknown>): shape is SchemaShape {
  return typeof shape.type === "string"
    || Array.isArray(shape.required)
    || shape.properties !== undefined
    || shape.items !== undefined
    || Array.isArray(shape.enum);
}

function validateSchemaShape(value: unknown, schema: SchemaShape, path: string): string[] {
  const failures: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    failures.push(`key '${path}' must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }

  if (schema.type === "object") {
    if (!isRecord(value)) {
      return [...failures, `key '${path}' must be an object`];
    }
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const field of required) {
      if (value[field] === undefined) {
        failures.push(`missing required key '${path}.${field}'`);
      }
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [field, childSchema] of Object.entries(properties)) {
      if (value[field] !== undefined) {
        failures.push(...validateField(value[field], childSchema, `${path}.${field}`));
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties));
      for (const field of Object.keys(value)) {
        if (!allowed.has(field)) {
          failures.push(`key '${path}.${field}' is not allowed by additionalProperties=false`);
        }
      }
    }
    return failures;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return [...failures, `key '${path}' must be an array`];
    }
    if (schema.items !== undefined) {
      for (const [index, item] of value.entries()) {
        failures.push(...validateField(item, schema.items, `${path}[${index}]`));
      }
    }
    return failures;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      return [...failures, `key '${path}' must be a string, received ${typeof value}`];
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      failures.push(`key '${path}' must have length >= ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      failures.push(`key '${path}' must have length <= ${schema.maxLength}`);
    }
    return failures;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || (schema.type === "integer" && !Number.isInteger(value))) {
      return [...failures, `key '${path}' must be a ${schema.type}`];
    }
    return failures;
  }

  if (schema.type === "boolean") {
    return typeof value === "boolean" ? failures : [...failures, `key '${path}' must be a boolean`];
  }

  return failures;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
