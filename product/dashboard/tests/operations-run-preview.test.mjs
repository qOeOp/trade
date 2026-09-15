import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("contextual run inspection is one shared GET-only fail-closed component", async () => {
  const preview = await read("components/operations-run-preview.tsx");

  assert.match(preview, /parseRunDetailEnvelopeV1/);
  assert.match(preview, /fetch\(`\/api\/operations\/runs\/\$\{encodeURIComponent\(runIdentity\)\}\/`/u);
  assert.match(preview, /method: "GET"/u);
  assert.match(preview, /cache: "no-store"/u);
  assert.match(preview, /parsed\.run_identity !== runIdentity/u);
  assert.match(preview, /parsed\.run\.run_identity !== runIdentity/u);
  assert.match(preview, /else if \(!response\.ok \|\| !parsed\.run/u);
  assert.match(preview, /requestGeneration\.current/u);
  assert.match(preview, /controller\.abort\(\)/u);
  assert.match(preview, /setState\(\{ status: "loading" \}\)/u);
  assert.doesNotMatch(preview, /method: "(?:POST|PUT|PATCH|DELETE)"/u);
  assert.doesNotMatch(preview, /logs|resolveOwner|cancelQueued|deleteCache/u);
  assert.match(preview, /Open full run details/u);
  assert.match(preview, /backLabel = "Back"/u);
  assert.match(preview, /\{backLabel\}/u);
  assert.match(preview, /onBack \? <Button[^>]+autoFocus/u);
});

test("schedule views reuse one contextual preview for table and detail origins", async () => {
  const [history, current] = await Promise.all([
    read("components/operations-schedule-history.tsx"),
    read("components/operations-schedules-preview.tsx"),
  ]);

  assert.equal((history.match(/<OperationsRunPreviewTrigger/g) ?? []).length, 2);
  assert.doesNotMatch(history, /href=\{`\/operations\/runs\//u);
  assert.match(history, /ignoreRowClick: true/u);
  assert.match(history, /returnToSchedule[\s\S]*restoreRunPreviewTriggerFocus\(runIdentity\)/u);
  assert.match(history, /onOpen=\{\(runIdentity\) => onOpenRun\(runIdentity, schedule\.schedule_identity\)\}/u);
  assert.match(history, /onOpen=\{\(runIdentity\) => openRunPreview\(runIdentity, null\)\}/u);
  assert.match(history, /selected\?\.schedule_identity === previewReturnScheduleIdentity/u);
  assert.equal((history.match(/<DetailSheet/g) ?? []).length, 1);
  assert.equal((current.match(/<OperationsRunPreviewTrigger/g) ?? []).length, 2);
  assert.match(current, /<OperationsRunPreviewContent runIdentity=\{previewRunIdentity\}/u);
  assert.match(current, /returnToSchedule[\s\S]*restoreRunPreviewTriggerFocus\(runIdentity\)/u);
  assert.match(current, /selected\?\.schedule_identity === previewReturnScheduleIdentity/u);
  assert.match(current, /const selectCalendarSchedule = useCallback\([\s\S]*setDetailOpen\(false\)/u);
  assert.match(current, /<ScheduleCalendar[\s\S]*onSelect=\{selectCalendarSchedule\}/u);
  assert.match(current, /onOpenRun=\{\(runIdentity\) => openRunPreview\(runIdentity, null\)\}/u);
  assert.doesNotMatch(current, /href=\{`\/operations\/runs\//u);
  assert.equal((current.match(/<DetailSheet/g) ?? []).length, 1);
});

test("the bilingual schedule contract fixes single-overlay contextual run inspection", async () => {
  const [en, zh] = await Promise.all([
    read("../../docs/guide/dashboard.md"),
    read("../../docs/guide/dashboard.zh.md"),
  ]);
  for (const doc of [en, zh]) {
    assert.match(doc, /RunDetailEnvelopeV1/u);
    assert.match(doc, /Open full run details/u);
    assert.match(doc, /Back to schedule/u);
  }
  assert.match(en, /never stacks a second overlay/u);
  assert.match(zh, /不得叠第二层/u);
});
