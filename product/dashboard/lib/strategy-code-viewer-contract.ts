export type StrategyCodeViewerAvailability = "loading" | "available" | "unavailable";
export type StrategyCodeLanguage = "rust" | "python" | "javascript" | "typescript" | "json" | "wat" | "text";
export type WasmPreviewStatus = "not_run" | "succeeded" | "failed" | "unavailable";

export type StrategyCodeSource = Readonly<{
  fileName: string;
  language: StrategyCodeLanguage;
  content: string;
  digest: string;
}>;

export type WasmPreviewDiagnostic = Readonly<{
  severity: "info" | "warning" | "error";
  line: number | null;
  column: number | null;
  message: string;
}>;

export type WasmPreviewProjection = Readonly<{
  status: WasmPreviewStatus;
  moduleIdentity: string | null;
  target: string | null;
  durationMs: number | null;
  observedAt: string | null;
  output: string | null;
  diagnostics: readonly WasmPreviewDiagnostic[];
  reason: string | null;
}>;

export type StrategyCodeViewerProjection = Readonly<{
  availability: StrategyCodeViewerAvailability;
  artifactIdentity: string | null;
  observedAt: string | null;
  source: StrategyCodeSource | null;
  wasmPreview: WasmPreviewProjection | null;
  reason: string | null;
}>;

const PROJECTION_KEYS = ["artifactIdentity", "availability", "observedAt", "reason", "source", "wasmPreview"];
const SOURCE_KEYS = ["content", "digest", "fileName", "language"];
const PREVIEW_KEYS = ["diagnostics", "durationMs", "moduleIdentity", "observedAt", "output", "reason", "status", "target"];
const DIAGNOSTIC_KEYS = ["column", "line", "message", "severity"];
const AVAILABILITIES = new Set<StrategyCodeViewerAvailability>(["loading", "available", "unavailable"]);
const LANGUAGES = new Set<StrategyCodeLanguage>(["rust", "python", "javascript", "typescript", "json", "wat", "text"]);
const PREVIEW_STATUSES = new Set<WasmPreviewStatus>(["not_run", "succeeded", "failed", "unavailable"]);
const DIAGNOSTIC_SEVERITIES = new Set<WasmPreviewDiagnostic["severity"]>(["info", "warning", "error"]);
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_DIAGNOSTICS = 200;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === keys.join("|");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function boundedText(value: unknown, maxBytes: number, allowEmpty = false): value is string {
  return typeof value === "string"
    && (allowEmpty || value.trim().length > 0)
    && !value.includes("\0")
    && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function identity(value: unknown): value is string {
  return boundedText(value, 512) && !/[\r\n]/u.test(value);
}

function source(value: unknown): value is StrategyCodeSource {
  if (!record(value) || !exactKeys(value, SOURCE_KEYS)) return false;
  return boundedText(value.fileName, 256)
    && !/[\r\n]/u.test(value.fileName)
    && LANGUAGES.has(value.language as StrategyCodeLanguage)
    && boundedText(value.content, MAX_SOURCE_BYTES, true)
    && typeof value.digest === "string"
    && DIGEST.test(value.digest);
}

function diagnostic(value: unknown): value is WasmPreviewDiagnostic {
  if (!record(value) || !exactKeys(value, DIAGNOSTIC_KEYS)) return false;
  const position = (entry: unknown) => entry === null
    || (Number.isSafeInteger(entry) && Number(entry) >= 1);
  return typeof value.severity === "string"
    && DIAGNOSTIC_SEVERITIES.has(value.severity as WasmPreviewDiagnostic["severity"])
    && position(value.line)
    && position(value.column)
    && boundedText(value.message, 4_096);
}

function preview(value: unknown): value is WasmPreviewProjection {
  if (!record(value) || !exactKeys(value, PREVIEW_KEYS)
    || typeof value.status !== "string"
    || !PREVIEW_STATUSES.has(value.status as WasmPreviewStatus)
    || !Array.isArray(value.diagnostics)
    || value.diagnostics.length > MAX_DIAGNOSTICS
    || !value.diagnostics.every(diagnostic)) return false;

  if (value.status === "not_run" || value.status === "unavailable") {
    return value.moduleIdentity === null
      && value.target === null
      && value.durationMs === null
      && value.observedAt === null
      && value.output === null
      && value.diagnostics.length === 0
      && boundedText(value.reason, 512);
  }

  return identity(value.moduleIdentity)
    && identity(value.target)
    && Number.isFinite(value.durationMs)
    && Number(value.durationMs) >= 0
    && Number(value.durationMs) <= 86_400_000
    && canonicalTimestamp(value.observedAt)
    && boundedText(value.output, MAX_OUTPUT_BYTES, true)
    && (value.status === "succeeded"
      ? value.reason === null
      : boundedText(value.reason, 512));
}

export function unavailableStrategyCodeViewer(
  reason = "INVALID_STRATEGY_CODE_VIEWER_PROJECTION",
): StrategyCodeViewerProjection {
  return {
    availability: "unavailable",
    artifactIdentity: null,
    observedAt: null,
    source: null,
    wasmPreview: null,
    reason,
  };
}

export function normalizeStrategyCodeViewerProjection(value: unknown): StrategyCodeViewerProjection {
  if (!record(value) || !exactKeys(value, PROJECTION_KEYS)) return unavailableStrategyCodeViewer();
  if (typeof value.availability !== "string"
    || !AVAILABILITIES.has(value.availability as StrategyCodeViewerAvailability)) {
    return unavailableStrategyCodeViewer();
  }

  if (value.availability !== "available") {
    const valid = value.artifactIdentity === null
      && value.observedAt === null
      && value.source === null
      && value.wasmPreview === null
      && (value.availability === "loading"
        ? value.reason === null
        : boundedText(value.reason, 512));
    return valid ? value as unknown as StrategyCodeViewerProjection : unavailableStrategyCodeViewer();
  }

  if (!identity(value.artifactIdentity)
    || !canonicalTimestamp(value.observedAt)
    || !source(value.source)
    || !preview(value.wasmPreview)
    || value.reason !== null) return unavailableStrategyCodeViewer();

  return value as unknown as StrategyCodeViewerProjection;
}

export function strategyCodeLineCount(content: string): number {
  return content.length === 0 ? 0 : content.split("\n").length;
}

export function strategyCodeLanguageLabel(language: StrategyCodeLanguage): string {
  return ({
    rust: "Rust",
    python: "Python",
    javascript: "JavaScript",
    typescript: "TypeScript",
    json: "JSON",
    wat: "WebAssembly Text",
    text: "Plain text",
  })[language];
}
