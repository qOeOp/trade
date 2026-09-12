import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("InlineNotice owns reusable icon, copy, tone, and card geometry", async () => {
  const [atom, css, replay, schedules, replayCss, calendarCss] = await Promise.all([
    read("components/ui/inline-notice.tsx"),
    read("components/ui/inline-notice.module.css"),
    read("components/exploratory-replay-readback-workbench.tsx"),
    read("components/operations-schedules-preview.tsx"),
    read("components/exploratory-replay-readback-workbench.module.css"),
    read("components/ui/schedule-calendar.module.css"),
  ]);

  assert.match(atom, /export function InlineNotice/u);
  assert.match(atom, /data-ui="inline-notice"/u);
  assert.match(atom, /data-tone=\{tone\}/u);
  assert.match(atom, /data-density=\{density\}/u);
  assert.doesNotMatch(atom, /Replay|Schedule|Owner|\.\.\/lib/iu);
  assert.match(css, /\.root \{[\s\S]*border-radius: var\(--panel-inner-radius\)/u);
  assert.match(css, /\.root\[data-density="compact"\] \{[^}]*min-height: 48px/u);
  assert.match(css, /\.root\[data-density="spacious"\] \{[^}]*min-height: 144px/u);
  assert.doesNotMatch(css, /border-radius:\s*999px|#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);

  for (const consumer of [replay, schedules]) assert.match(consumer, /<InlineNotice/u);
  assert.match(replay, /className=\{styles\.resultNotice\}/u);
  assert.match(schedules, /className=\{styles\.scheduleNotice\}/u);
  assert.doesNotMatch(replayCss, /\.resultRail/u);
  assert.doesNotMatch(calendarCss, /\.unavailableCalendar|\.emptyResult|\.availabilityNotice/u);
});
