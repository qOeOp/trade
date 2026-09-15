import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Research decisions reuse exact Owner cuts and shared Dashboard atoms", async () => {
  const [component, projection, shell, page, navigation] = await Promise.all([
    readFile(new URL("../components/research-decision-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/research-decision-projection.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/[...route]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/navigation.js", import.meta.url), "utf8"),
  ]);
  assert.match(component, /useHistoricalCustodyDirectory\(true\)/u);
  assert.match(component, /useResearchOutcomeInventory\(true\)/u);
  assert.match(component, /projectResearchDecisionDirectoryV1/u);
  assert.match(projection, /researchOutcomeInventoryMatchesCustodyV1/u);
  assert.match(projection, /custody\.completeness !== "COMPLETE"/u);
  assert.match(projection, /inventory\.completeness !== "complete"/u);
  assert.match(projection, /inventory\.unavailableTotal !== 0/u);
  assert.match(projection, /rows\.length !== inventory\.outcomeReadyTotal/u);
  assert.match(projection, /outcome\.resolution === "quarantined" \? "historical" : "current"/u);
  assert.match(component, /<CompactStatusBar aria-label="Research decision summary">/u);
  for (const label of ["decisions", "accepted", "rejected", "requests", "decided", "waiting"]) {
    assert.match(component, new RegExp(`label="${label}"`, "u"));
  }
  assert.match(component, /href="\/rd\/decisions\/\?decision=accepted"/u);
  assert.match(component, /href="\/rd\/decisions\/\?decision=rejected"/u);
  assert.match(component, /href="\/rd\/research\/\?outcome=awaiting"/u);
  assert.match(component, /<DataWorkspaceTable<ResearchDecisionRowV1>/u);
  for (const header of ["Research request", "Decision", "Record", "Request recorded"]) {
    assert.match(component, new RegExp(`DataTableHeaderLabel>${header}<`, "u"));
  }
  assert.match(component, /<EntityReference label="Research request"/u);
  assert.match(component, /label="Decision filter"/u);
  assert.match(component, /title="Research decisions unavailable"/u);
  assert.doesNotMatch(component, />Approve<|>Reject<|>Resolve<|>Submit<|>Run<|textarea|contentEditable/u);
  assert.match(shell, /current === "\/rd\/decisions"/u);
  assert.match(shell, /<ResearchDecisionDirectory initialDecision=\{researchDecisionFilter\}/u);
  assert.match(page, /query\.decision === "accepted"[\s\S]+query\.decision === "rejected"/u);
  assert.match(navigation, /"\/rd\/decisions": \{ summaries: \["Accepted", "Rejected", "Decided", "Waiting"\], primary: "ResearchDecisionDirectory"/u);
});

test("bilingual Research decision contract fixes meaning, geometry, and no-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix ? "### Research 决策历史" : "### Research decision history";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "ResearchDecisionDirectory", "/rd/decisions", "/api/rd/research/outcome-inventory",
      "/api/rd/historical-custodies", "accepted | rejected", "Current", "Historical",
      "CompactStatusBar", "decisions", "accepted", "rejected", "requests", "decided", "waiting",
      "?decision=accepted|rejected", "/rd/research/?outcome=awaiting", "All / Accepted / Rejected",
      "Research request", "Decision", "Record", "Request recorded", "EntityReference", "20/50",
      "unavailable", "Refresh", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
