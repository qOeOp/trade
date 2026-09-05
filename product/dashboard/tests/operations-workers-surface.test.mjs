import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Workers is a GET-only RunStore projection wired into the exact Operations route", async () => {
  const [shell, listRoute, detailRoute, detailPage] = await Promise.all([
    source("components/dashboard-shell.tsx"),
    source("app/api/operations/workers/route.ts"),
    source("app/api/operations/workers/[workerIdentity]/route.ts"),
    source("app/operations/workers/[workerIdentity]/page.tsx"),
  ]);

  assert.match(shell, /operationsWorkers \? <OperationsWorkersPreview initialWorkerIdentity=\{workerIdentity\} \/>/);
  assert.match(shell, /RUN_STORE_WORKER_READ_ONLY - NO_WORKER_ADMIN/);
  assert.match(listRoute, /export async function GET/);
  assert.match(listRoute, /store\.listShadowWorkers\(\)/);
  assert.match(detailRoute, /export async function GET/);
  assert.match(detailRoute, /store\.readShadowWorker\(workerIdentity\)/);
  assert.match(detailRoute, /WORKER_NOT_FOUND/);
  assert.match(detailPage, /workerIdentity=\{workerIdentity\}/);
  assert.doesNotMatch(listRoute + detailRoute, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("Workers keeps one compact summary, one dense table, and one exact detail surface", async () => {
  const workers = await source("components/operations-workers-preview.tsx");

  assert.match(workers, /<CompactStatusBar[^>]*aria-label="Worker summary"/);
  assert.match(workers, /<DataWorkspaceTable<WorkerBrowserProjectionV1>/);
  assert.match(workers, /columns="minmax\(560px, 1\.55fr\) minmax\(300px, \.8fr\)"/);
  assert.match(workers, /<TableToolbar filter=\{<TableFilterMenu/);
  assert.match(workers, /<FilterSearch[\s\S]*?placeholder="Worker, operation, or run"/);
  assert.match(workers, /dataWorkspaceSelectedRowStyles<WorkerBrowserProjectionV1>/);
  assert.match(workers, /pagination paginationPerPage=\{20\}/);
  assert.match(workers, /Heartbeat history unavailable/);
  assert.match(workers, /Memory and host are not inferred/);
  assert.match(workers, /no unbound-run readiness claim/);
  assert.doesNotMatch(workers, />Restart|>Clean cache|>Create|>Edit|>REPL/);
  assert.doesNotMatch(workers, /method: "POST"|method: "PUT"|method: "PATCH"|method: "DELETE"/);
});

test("Workers uses the shared Vibe, table, and Lucide-backed atoms", async () => {
  const workers = await source("components/operations-workers-preview.tsx");

  for (const shared of [
    "PanelFrame", "PanelFrameHeader", "PanelFrameBody", "CompactStatusBar",
    "DataWorkspaceTable", "DataTableSurface", "DetailInspector", "SplitBento",
  ]) assert.match(workers, new RegExp(shared));
  assert.match(workers, /from "\.\/ui\/iconography"/);
  assert.doesNotMatch(workers, /from "lucide-react"/);
  assert.doesNotMatch(workers, /#[0-9a-fA-F]{3,8}/);
});

test("exact detail rendering is independent of list availability", async () => {
  const compiled = ts.transpileModule(await source("components/operations-workers-preview.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const require = createRequire(import.meta.url);
  const identity = "a-worker";
  const worker = {
    worker_identity: identity, operation_ids: [], lease_state: "available", job_count: 0,
    active_job_count: 0, last_run_identity: null, last_run_state: null, last_run_at: null,
    registered_at: null, last_heartbeat_at: null, lease_expires_at: null,
    worker_artifact_digest: "test-artifact",
  };
  const atom = ({ children }) => React.createElement("div", null, children);
  const icons = new Proxy({}, { get: () => atom });
  for (const listAvailable of [false, true]) {
    for (const detailAvailable of [false, true]) {
      const state = [
        { availability: listAvailable ? "available" : "unavailable", workers: [], unavailable_reason: "LIST_UNAVAILABLE" },
        { availability: detailAvailable ? "available" : "unavailable", worker: detailAvailable ? worker : null, unavailable_reason: "DETAIL_UNAVAILABLE" },
        identity, "all", "", false,
      ];
      const exports = {};
      const load = (path) => {
        if (path === "react") return {
          ...React, useState: () => [state.shift(), () => {}], useEffect: () => {},
          useMemo: (fn) => fn(), useCallback: (fn) => fn,
        };
        if (path === "react/jsx-runtime") return require(path);
        if (path.includes("worker-browser-contract")) return {};
        return new Proxy({}, { get: (_, key) => {
          if (String(key).endsWith("Icons")) return icons;
          if (key === "dataWorkspaceSelectedRowStyles") return () => [];
          if (key === "availabilityTone") return () => "neutral";
          if (key === "DetailInspectorHeader") return ({ eyebrow, title }) => React.createElement("header", null, eyebrow, title);
          return atom;
        } });
      };
      // Execute the production render tree; only hooks and unrelated visual atoms are substituted.
      new Function("require", "exports", compiled)(load, exports);
      const html = renderToStaticMarkup(React.createElement(exports.OperationsWorkersPreview, { initialWorkerIdentity: identity }));
      assert.match(html, /Exact worker readback/);
      if (detailAvailable) {
        assert.match(html, /test-artifact/);
        assert.doesNotMatch(html, /DETAIL_UNAVAILABLE/);
      } else {
        assert.match(html, /DETAIL_UNAVAILABLE/);
        assert.doesNotMatch(html, /test-artifact/);
      }
    }
  }
});
