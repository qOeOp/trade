import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const auditUrl = new URL("../components/operations-audit.tsx", import.meta.url);
const atomUrl = new URL("../components/ui/timeline-list.tsx", import.meta.url);

test("TimelineList owns ordered timeline presentation without Audit domain behavior", async () => {
  const [audit, atom] = await Promise.all([
    readFile(auditUrl, "utf8"),
    readFile(atomUrl, "utf8"),
  ]);

  assert.match(audit, /import \{ TimelineItem, TimelineList \} from "\.\/ui\/timeline-list"/);
  assert.match(audit, /<TimelineList>/);
  assert.match(audit, /<TimelineItem/);
  assert.doesNotMatch(audit, /<ol className="timeline-list"|<li className="timeline-event"/);

  assert.match(atom, /<ol \{\.\.\.props\} className=\{\["timeline-list", className\]/);
  assert.match(atom, /<li \{\.\.\.props\} className=\{\["timeline-event", className\]/);
  assert.match(atom, /className="timeline-event-(?:index|copy|meta|status)"/);
  assert.doesNotMatch(atom, /Audit|audit_|receipt_identity|operationLabel|outcome|StatusBadge|fetch\(|\.sort\(|\.\.\/lib/iu);
});

test("Audit keeps identity, time, ordering and outcome presentation at the consumer boundary", async () => {
  const audit = await readFile(auditUrl, "utf8");

  assert.match(audit, /timeline\.map\(\(event, index\) => <TimelineItem/);
  assert.match(audit, /key=\{event\.audit_identity\}/);
  assert.match(audit, /index=\{String\(index \+ 1\)\.padStart\(2, "0"\)\}/);
  assert.match(audit, /primary=\{operationLabel\(event\.operation\)\}/);
  assert.match(audit, /primaryTitle=\{event\.operation\}/);
  assert.match(audit, /description=\{compactIdentity\(event\.receipt_identity\)\}/);
  assert.match(audit, /descriptionTitle=\{event\.receipt_identity\}/);
  assert.match(audit, /meta=\{<time dateTime=\{event\.observed_at\}>\{displayTime\(event\.observed_at\)\}<\/time>\}/);
  assert.match(audit, /status=\{<StatusBadge tone=\{auditOutcomeTone\(event\.outcome\)\}>\{event\.outcome\}<\/StatusBadge>\}/);
});
