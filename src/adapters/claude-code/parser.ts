import type { ExecuteResult } from "../base";

export interface ClaudeStreamEvent {
  readonly type?: string;
  readonly subtype?: string;
  readonly result?: unknown;
  readonly message?: unknown;
  readonly content?: unknown;
  readonly error?: unknown;
  readonly is_error?: unknown;
  readonly [key: string]: unknown;
}

export function parseClaudeStreamJson(stream: string): ExecuteResult {
  const lines = stream.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return failed("Claude stream-json output was empty", stream);
  }

  const textParts: string[] = [];
  let finalText: string | undefined;
  let sawResult = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let event: ClaudeStreamEvent;
    try {
      event = JSON.parse(line) as ClaudeStreamEvent;
    } catch (error) {
      return failed(`Unable to parse Claude stream-json line ${index + 1}: ${errorMessage(error)}`, stream);
    }

    const eventFailure = classifyEventFailure(event);
    if (eventFailure !== undefined) {
      return { ...eventFailure, raw_transcript: stream };
    }

    const eventTexts = extractText(event);
    textParts.push(...eventTexts);

    if (event.type === "result") {
      sawResult = true;
      const resultText = extractResultText(event.result);
      if (resultText !== undefined) {
        finalText = resultText;
      }
    }
  }

  const candidate = (finalText ?? textParts.join("\n")).trim();
  if (!sawResult && candidate.length === 0) {
    return failed("Claude stream-json did not include a result event or text content", stream);
  }

  const output = parseOutputObject(candidate);
  if (output === undefined) {
    return failed("Claude output did not contain a structured JSON object", stream);
  }

  return {
    status: "complete",
    output,
    raw_transcript: stream,
    artifacts: extractArtifacts(output),
  };
}

function classifyEventFailure(event: ClaudeStreamEvent): ExecuteResult | undefined {
  const combinedText = [
    typeof event.error === "string" ? event.error : undefined,
    typeof event.result === "string" ? event.result : undefined,
    ...extractText(event),
  ].filter((value): value is string => value !== undefined).join("\n");

  if (event.is_error === true) {
    return classifyText(combinedText || "Claude stream-json event reported an error");
  }

  if (event.type === "result" && typeof event.subtype === "string" && event.subtype !== "success") {
    return classifyText(combinedText || `Claude result subtype was '${event.subtype}'`);
  }

  if (combinedText.length > 0 && containsBlockingText(combinedText)) {
    return classifyText(combinedText);
  }

  return undefined;
}

function classifyText(text: string): ExecuteResult {
  if (/rate.?limit|too many requests|quota|429/i.test(text)) {
    return blocked(text);
  }
  if (/auth|login|credential|api key|unauthorized|not authenticated|permission denied/i.test(text)) {
    return blocked(text);
  }
  if (/validation|invalid argument|unknown option|requires --verbose|usage:/i.test(text)) {
    return failed(text, text);
  }
  return failed(text, text);
}

function containsBlockingText(text: string): boolean {
  return /rate.?limit|too many requests|quota|429|auth|login|credential|api key|unauthorized|not authenticated|permission denied|validation|invalid argument|unknown option|requires --verbose/i.test(text);
}

function extractText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractText(item));
  }
  if (!isRecord(value)) {
    return [];
  }

  const parts: string[] = [];
  if (typeof value.text === "string") {
    parts.push(value.text);
  }
  if (typeof value.content === "string") {
    parts.push(value.content);
  } else if (Array.isArray(value.content)) {
    parts.push(...value.content.flatMap((item) => extractText(item)));
  }
  if (isRecord(value.message)) {
    parts.push(...extractText(value.message));
  }
  return parts;
}

function extractResultText(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result;
  }
  if (isRecord(result) || Array.isArray(result)) {
    return JSON.stringify(result);
  }
  return undefined;
}

function parseOutputObject(text: string): Record<string, unknown> | undefined {
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    candidates.push(fenced[1].trim());
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function extractArtifacts(output: Record<string, unknown>): string[] {
  if (!Array.isArray(output.artifacts)) {
    return [];
  }
  return output.artifacts.filter((artifact): artifact is string => typeof artifact === "string");
}

function blocked(error: string): ExecuteResult {
  return { status: "blocked", output: {}, error: normalizeError(error) };
}

function failed(error: string, rawTranscript?: string): ExecuteResult {
  return { status: "failed", output: {}, error: normalizeError(error), raw_transcript: rawTranscript };
}

function normalizeError(error: string): string {
  return error.trim() || "Claude stream-json parsing failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
