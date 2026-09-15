import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Research detail reuses shared atoms and exposes the admitted Artifact control", async () => {
  const [component, content, hook, drilldown, questionBrief, control, gate, route, page, shell, navigation, css] = await Promise.all([
    readFile(new URL("../components/research-readback-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/research-readback-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-research-readback.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/research-readback-drilldown.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/research-question-brief.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/artifact-formation-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/action-admission-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/research/[requestIdentity]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/rd/research/[requestIdentity]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/navigation.js", import.meta.url), "utf8"),
    readFile(new URL("../components/research-readback-workspace.module.css", import.meta.url), "utf8"),
  ]);
  for (const atom of ["PanelFrame", "PanelFrameHeader", "PanelFrameBody", "JourneyProgress", "FactGroupGrid", "FactGroup", "FactItem", "StatusBadge"]) {
    assert.ok(component.includes(atom) || content.includes(atom), `missing shared atom ${atom}`);
  }
  for (const title of ["Result", "Strategy", "Timing"]) assert.match(content, new RegExp(`title="${title}"`, "u"));
  assert.match(content, /Needs current review/u);
  assert.match(content, /humanizeReasonCode/u);
  assert.match(content, /const decision = quarantined \? outcome\.historicalDisposition : outcome\.resolution/u);
  assert.match(content, /decision === "accepted" \? "success"/u);
  assert.match(content, /projectResearchJourneyV1\(projection\)/u);
  assert.match(component, /researchQuestionForReadbackV1\(questions\.projection, readback\.projection\)/u);
  assert.match(component, /useResearchQuestionDirectory\(true\)/u);
  assert.match(component, /Promise\.all\(\[readback\.read\(\), questions\.read\(\)\]\)/u);
  assert.match(content, /<ResearchQuestionBrief item=\{question\}/u);
  assert.match(questionBrief, /SummaryList/u);
  for (const label of ["Research question", "Falsifier", "Expected observation"]) {
    assert.match(questionBrief, new RegExp(label, "u"));
  }
  assert.match(component, /PanelFrameInfo/u);
  assert.doesNotMatch(component, /projection\?\.technical\s*\?\s*<PanelFrameInfo/u);
  assert.match(component, /variant="ghost" href="\/rd\/research"/u);
  assert.match(component, /variant="secondary"/u);
  assert.match(hook, /fetch\(`\/api\/rd\/research\/\$\{encodeURIComponent\(requestIdentity\)\}\/`/u);
  assert.match(hook, /new AbortController\(\)/u);
  assert.match(hook, /generation\.current \+= 1/u);
  assert.match(hook, /activeRequest\.current\?\.abort\(\)/u);
  assert.match(hook, /!response\.ok[\s\S]+parsed\.availability !== "available"/u);
  assert.match(hook, /setProjection\(parsed\?\.availability === "unavailable" \? parsed : null\)/u);
  assert.match(route, /readResearchReadbackGatewayV1/u);
  assert.match(route, /cache-control/u);
  assert.match(page, /researchRequestIdentity=\{requestIdentity\}/u);
  assert.match(shell, /<ResearchReadbackWorkspace requestIdentity=\{researchRequestIdentity!\}/u);
  assert.match(navigation, /\^\\\/rd\\\/research\\\/\[\^\/\]\+\$/u);
  assert.match(component, /<ResearchReadbackContent[\s\S]+allowFormation/u);
  assert.match(content, /allowFormation[\s\S]+<ArtifactFormationControl researchRequestIdentity=\{requestIdentity\}/u);
  assert.match(drilldown, /<ResearchReadbackContent/u);
  assert.doesNotMatch(drilldown, /allowFormation|ArtifactFormationControl/u);
  assert.match(drilldown, /Back to request summary/u);
  assert.match(drilldown, /readback\.status === "available"[\s\S]+Open full research workspace/u);
  assert.match(content, /className=\{styles\.readbackGrid\}/u);
  assert.match(css, /\.readbackGrid \{[\s\S]*repeat\(auto-fit, minmax\(min\(100%, 240px\), 1fr\)\)/u);
  assert.match(control, /ArtifactFormationControl/u);
  assert.match(control, /PREFLIGHTING[\s\S]+ADMITTING[\s\S]+SUBMITTED_OR_UNKNOWN/u);
  assert.match(control, /\/api\/rd\/artifacts\/formations\/preflight\//u);
  assert.match(control, /\/api\/rd\/artifacts\/formations\//u);
  assert.match(control, /identity_mode: "EXACT"/u);
  assert.match(gate, /DetailInspector[\s\S]+Input[\s\S]+StatusBadge/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});

test("bilingual Research detail contract closes geometry and the Authorization B boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix
      ? "## 有界准入：已验证 Research 目录与精确回读"
      : "## Bounded admission: verified Research directory and exact readback";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "/rd/research/{requestIdentity}", "PanelFrame", "FactGroup", "Result", "Strategy", "Timing",
      "Back to requests", "Refresh", suffix ? "技术" : "technical", "unavailable", "SUBMITTED_OR_UNKNOWN",
      "GET", "research_goal.shadow_resolve.v1", "ActionAdmissionGate", "PREFLIGHTING", "ADMITTING",
      "Resolve", "Windmill", "Owner", "write", "trading",
      "Needs current review", "Raw outcome", "Raw reason",
      "hypothesis", "falsification_question", "expected_observation", "semantic_digest", "committed_at_epoch_ms",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
