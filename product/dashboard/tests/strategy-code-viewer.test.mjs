import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeStrategyCodeViewerProjection,
  strategyCodeLanguageLabel,
  strategyCodeLineCount,
  unavailableStrategyCodeViewer,
} from "../lib/strategy-code-viewer-contract.ts";

const source = {
  fileName: "mean_reversion.rs",
  language: "rust",
  content: "pub fn signal(spread: i64) -> i64 {\n    -spread\n}\n",
  digest: `sha256:${"a".repeat(64)}`,
};

const succeededPreview = {
  status: "succeeded",
  moduleIdentity: "wasm-module-7",
  target: "wasm32-wasip1",
  durationMs: 12.5,
  observedAt: "2026-09-06T03:00:00.000Z",
  output: "signal=-17",
  diagnostics: [{ severity: "info", line: 1, column: 1, message: "Sandbox preview completed." }],
  reason: null,
};

const available = {
  availability: "available",
  artifactIdentity: "artifact-7",
  observedAt: "2026-09-06T03:00:01.000Z",
  source,
  wasmPreview: succeededPreview,
  reason: null,
};

const unavailablePreview = {
  status: "unavailable",
  moduleIdentity: null,
  target: null,
  durationMs: null,
  observedAt: null,
  output: null,
  diagnostics: [],
  reason: "WASM_PREVIEW_UNAVAILABLE",
};

test("accepts exact bounded Owner source and explicit WASM preview states", () => {
  assert.equal(normalizeStrategyCodeViewerProjection(available), available);
  const withoutPreview = { ...available, wasmPreview: unavailablePreview };
  assert.equal(normalizeStrategyCodeViewerProjection(withoutPreview), withoutPreview);
  assert.equal(strategyCodeLineCount(source.content), 4);
  assert.equal(strategyCodeLineCount(""), 0);
  assert.equal(strategyCodeLanguageLabel("wat"), "WebAssembly Text");
});

test("invalid, contradictory, oversized, and invented projections fail closed", () => {
  const invalid = unavailableStrategyCodeViewer();
  const oversizedSource = { ...source, content: "x".repeat(256 * 1024 + 1) };
  const invalidDiagnostic = {
    ...succeededPreview,
    diagnostics: [{ severity: "error", line: 0, column: 1, message: "invalid line" }],
  };

  for (const candidate of [
    null,
    {},
    { ...available, availability: "invalid" },
    { ...available, availability: ["available"] },
    { ...available, extra: true },
    { ...available, observedAt: "2026-09-06" },
    { ...available, source: { ...source, digest: "a".repeat(64) } },
    { ...available, source: oversizedSource },
    { ...available, source: { ...source, language: "shell" } },
    { ...available, wasmPreview: { ...unavailablePreview, output: "invented" } },
    { ...available, wasmPreview: { ...succeededPreview, status: ["succeeded"] } },
    { ...available, wasmPreview: { ...succeededPreview, moduleIdentity: null } },
    { ...available, wasmPreview: { ...succeededPreview, durationMs: Number.POSITIVE_INFINITY } },
    { ...available, wasmPreview: invalidDiagnostic },
    {
      ...available,
      wasmPreview: {
        ...succeededPreview,
        diagnostics: [{ severity: ["info"], line: 1, column: 1, message: "invalid severity" }],
      },
    },
    { ...available, wasmPreview: { ...succeededPreview, request: { run: true } } },
  ]) {
    assert.deepEqual(normalizeStrategyCodeViewerProjection(candidate), invalid);
  }
});

test("loading and unavailable states cannot retain stale positive source", () => {
  const loading = {
    availability: "loading",
    artifactIdentity: null,
    observedAt: null,
    source: null,
    wasmPreview: null,
    reason: null,
  };
  const unavailable = {
    availability: "unavailable",
    artifactIdentity: null,
    observedAt: null,
    source: null,
    wasmPreview: null,
    reason: "ARTIFACT_SOURCE_UNAVAILABLE",
  };
  assert.equal(normalizeStrategyCodeViewerProjection(loading), loading);
  assert.equal(normalizeStrategyCodeViewerProjection(unavailable), unavailable);
  assert.deepEqual(
    normalizeStrategyCodeViewerProjection({ ...unavailable, source }),
    unavailableStrategyCodeViewer(),
  );
});

test("component retains real CodeMirror read-only affordances and no execution path", async () => {
  const component = await readFile(new URL("../components/ui/strategy-code-viewer.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../components/ui/strategy-code-viewer.module.css", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  for (const required of [
    "new EditorView",
    "lineNumbers()",
    "foldGutter",
    "drawSelection()",
    "syntaxHighlighting",
    "EditorState.readOnly.of(true)",
    "EditorView.editable.of(false)",
    "@codemirror/lang-wast",
    "PanelFrameHeader",
    "PanelFrameBody",
    "PanelFrameFooter",
    "InterfaceIcons.copy",
    "useReducedMotion",
    "data-preview-mode",
  ]) {
    assert.ok(component.includes(required), `missing ${required}`);
  }
  for (const forbidden of [
    "EditorView.updateListener",
    "autocompletion(",
    "defaultKeymap",
    "onChange",
    "fetch(",
    "WebSocket",
    "contentEditable",
  ]) {
    assert.ok(!component.includes(forbidden), `unexpected ${forbidden}`);
  }
  assert.equal(packageJson.dependencies["@codemirror/view"], "6.43.11");
  assert.equal(packageJson.dependencies["@codemirror/lang-wast"], "6.0.2");
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/iu);
  assert.doesNotMatch(css, /rgba?\(/iu);
  assert.doesNotMatch(css, /hsla?\(/iu);
  assert.match(css, /\.shell\[data-preview-mode="compact"\]/u);
  assert.match(css, /\.preview\[data-status="not_run"\]/u);
});
