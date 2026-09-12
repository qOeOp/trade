import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("only admitted R&D surfaces embed their route chrome", async () => {
  const [shell, css] = await Promise.all([
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const predicate = shell.match(/const embedsRouteChrome = ([\s\S]*?);\n/u)?.[1];

  assert.ok(predicate, "embedded route chrome predicate is missing");
  assert.deepEqual(
    new Set(predicate.match(/[A-Za-z][A-Za-z]+/gu)),
    new Set([
      "sourceIntakeReadback",
      "composerReadback",
      "researchDirectory",
      "researchReadback",
      "artifactDirectory",
      "artifactSourceDetail",
    ]),
  );
  assert.match(shell, /const rdPlaceholderRoute = current === "\/rd\/hypotheses" \|\| current === "\/rd\/decisions";/u);
  assert.match(shell, /const ownsRouteChrome = embedsRouteChrome \|\| rdPlaceholderRoute;/u);
  assert.match(shell, /const suppressShellPageHeader = operationsSchedules \|\| operationsServiceLogs \|\| operationsAudit \|\| ownsRouteChrome;/u);
  assert.match(
    shell,
    /\{suppressShellPageHeader \? <h1 className="sr-only">\{page\.label\}<\/h1> : <header className="page-header">/u,
  );
  assert.match(
    shell,
    /\{!ownsRouteChrome && !operationsConnected && !marketDataFoundation[\s\S]*&& !runtimeFoundation && !portfolioUnavailable \? <footer className="prototype-notice">/u,
  );
  assert.match(css, /\.module-tabs \{[^}]*justify-self: end;/u);
  assert.doesNotMatch(predicate, /hypoth|decision|backtest|market|runtime|portfolio|operation/iu);
});

test("each embedded R&D panel owns an exact read-only boundary", async () => {
  const [source, composer, research, researchReadback, artifact, viewer] = await Promise.all([
    readFile(new URL("../components/source-intake-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/develop-composer-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/research-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/research-readback-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/artifact-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/strategy-code-viewer.tsx", import.meta.url), "utf8"),
  ]);
  const framedBoundaries = [
    "Owner point read · No submit or resolve",
    "Owner point read · No run, resolve, or edit",
    "Owner custody · Read only · No edit or execution",
  ];

  [source, composer, viewer].forEach((surface, index) => {
    assert.match(surface, /<PanelFrameHeader/u);
    assert.ok(surface.includes(`meta="${framedBoundaries[index]}"`), `${framedBoundaries[index]} is missing`);
  });
  assert.match(research, /<OwnerDirectoryInfo>[\s\S]+No research payloads, submission controls, or resolution actions are exposed here\./u);
  assert.match(researchReadback, /title="Research outcome"/u);
  assert.match(researchReadback, /<PanelFrameInfoFact label="Request"><code>\{requestIdentity\}<\/code><\/PanelFrameInfoFact>/u);
  assert.doesNotMatch(researchReadback, /description=/u);
  assert.match(researchReadback, /<ArtifactFormationControl researchRequestIdentity=\{requestIdentity\}/u);
  assert.match(artifact, /<OwnerDirectoryInfo>[\s\S]+No build, execution, or binding action is exposed here\./u);
});
