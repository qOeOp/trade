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
  const componentFiles = await Promise.all([
    "../components/ui/strategy-code-viewer.tsx",
    "../components/ui/strategy-code-viewer/read-only-code-mirror.tsx",
    "../components/ui/strategy-code-viewer/viewer-chrome.tsx",
    "../components/ui/strategy-code-viewer/viewer-file-rail.tsx",
    "../components/ui/strategy-code-viewer/viewer-evidence-panel.tsx",
    "../components/ui/strategy-code-viewer/viewer-source-cell.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const component = componentFiles.join("\n");
  const css = await readFile(new URL("../components/ui/strategy-code-viewer.module.css", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const sourceLock = JSON.parse(await readFile(new URL("../vibe-ui.lock.json", import.meta.url), "utf8"));

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
    'data-slot="strategy-viewer-chrome"',
    'data-slot="strategy-viewer-workspace"',
    'data-slot="strategy-viewer-file-rail"',
    'data-slot="strategy-viewer-content-frame"',
    'data-slot="strategy-viewer-file-tabs"',
    'data-slot="strategy-viewer-source-cell"',
    'data-slot="strategy-viewer-evidence-panel"',
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
  assert.ok(component.includes('safeProjection.source?.fileName ?? "Source unavailable"'));
  assert.ok(component.includes('data-active={source ? "true" : undefined}'));
  assert.equal(sourceLock.sourceSets.strategyCodeViewer.revision, "48c8315f74536d9d308347d63ac9c4e96c9a7120");
  assert.equal(sourceLock.sourceSets.strategyCodeViewer.tree, "d226b620dc699c9e8e382274434b324a5fefe0e1");
  assert.equal(sourceLock.sourceSets.strategyCodeViewer.components.contentFrame.blob, "59feee98003091a3296e70954fb8a23d0dd85f4e");
  assert.equal(sourceLock.sourceSets.strategyCodeViewer.components.codeMirror.blob, "9e8230f0ac8e93d56062803f63f9e3b2b7ee4e3e");
  assert.equal(packageJson.dependencies["@codemirror/view"], "6.43.11");
  assert.equal(packageJson.dependencies["@codemirror/lang-wast"], "6.0.2");
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/iu);
  assert.doesNotMatch(css, /rgba?\(/iu);
  assert.doesNotMatch(css, /hsla?\(/iu);
  assert.match(css, /\.workspace/u);
  assert.match(css, /\.contentFrame/u);
  assert.match(css, /\.sourceCell/u);
  assert.match(css, /\.evidencePanel/u);
  assert.match(css, /\.preview\[data-status="not_run"\]/u);
});
