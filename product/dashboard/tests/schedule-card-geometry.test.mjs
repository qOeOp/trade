import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("schedule surfaces keep rounded containment without stealing the calendar scroll", async () => {
  const css = await read("components/ui/schedule-calendar.module.css");

  assert.match(css, /\.primary, \.detail \{[^}]*border-radius:\s*var\(--panel-inner-radius\)[^}]*\}/u);
  assert.match(css, /\.primary \{\s*overflow:\s*clip;\s*\}/u);
  assert.match(css, /\.detail \{\s*overflow:\s*auto;\s*\}/u);
  assert.match(css, /\.calendarBody \{[^}]*overflow:\s*auto;/u);
  assert.match(css, /\.weekdayHeader \{[^}]*position:\s*sticky;[^}]*top:\s*0;/u);
  assert.doesNotMatch(css, /\.primary \{\s*overflow:\s*(?:auto|scroll|hidden)/u);
});

test("responsive schedule controls wrap as a grid and leave popovers unclipped", async () => {
  const [header, css] = await Promise.all([
    read("components/ui/schedule-calendar/header/calendar-header.tsx"),
    read("components/ui/schedule-calendar.module.css"),
  ]);

  assert.match(header, /data-slot="schedule-calendar-header"/u);
  assert.match(header, /<TodayButton[\s\S]*<DateNavigator[\s\S]*<FilterSchedules[\s\S]*<Views[\s\S]*<OperationSelect[\s\S]*refreshAction[\s\S]*<Settings/u);
  assert.match(css, /\.calendarHeader \{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/u);
  assert.match(css, /@media \(max-width: 1180px\) \{ \.calendarHeader \{ grid-template-columns: minmax\(0, 1fr\);/u);
  assert.match(css, /@media \(max-width: 820px\) \{ \.calendarTools,[^\n]+\.settingsMenu \{ width: 100%; \} \.settingsMenu > summary \{ margin-left: auto; \}/u);
  assert.doesNotMatch(css, /\.calendarHeader[^{}]*overflow-(?:x|inline):\s*(?:auto|scroll|hidden)/u);
  assert.match(css, /\.toolPopover \{[^}]*position:\s*absolute;[^}]*z-index:\s*8;/u);
  assert.match(css, /\.page:has\(\.operationScope\[open\]\) > :global\(\.panel-frame-body\) \{ min-height: 304px; \}/u);
});

test("schedule chrome uses the PanelFrame atom instead of self-drawn half-radius cards", async () => {
  const [component, css] = await Promise.all([
    read("components/operations-schedules-preview.tsx"),
    read("components/ui/schedule-calendar.module.css"),
  ]);

  assert.match(component, /<PanelFrame[^>]*>\s*<CalendarHeader[\s\S]*?\/>\s*<PanelFrameBody>/u);
  assert.match(component, /<\/PanelFrameBody>\s*<PanelFrameFooter className=\{styles\.foot\}>/u);
  assert.doesNotMatch(css, /\.calendarHeader \{[^}]*(?:border-radius|background|border-bottom):/u);
  assert.doesNotMatch(css, /\.foot \{[^}]*(?:border-radius|background):/u);
});

test("schedule unavailable and filtered-empty states are compact and truth preserving", async () => {
  const [component, css] = await Promise.all([
    read("components/operations-schedules-preview.tsx"),
    read("components/ui/schedule-calendar.module.css"),
  ]);

  assert.match(component, /data-availability="unavailable"/u);
  assert.match(component, /scheduleAvailabilityPresentationV1\(error\)\.title/u);
  assert.match(component, /!schedules\.length \? <div className=\{styles\.emptyResult\} role="status">/u);
  assert.doesNotMatch(component, /<ScheduleCalendar schedules=\{\[\]\}/u);
  assert.doesNotMatch(component, /CALENDAR_ITEMS_MOCK|Add Event/u);
  assert.match(css, /\.unavailableCalendar, \.emptyResult \{[^}]*min-height:\s*144px;/u);
  assert.doesNotMatch(css, /\.unavailableCalendar[^{}]*(?:height|min-height):\s*clamp\((?:500|760)px/u);
});
