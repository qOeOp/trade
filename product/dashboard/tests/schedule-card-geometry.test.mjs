import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("schedule surfaces keep rounded containment without stealing the calendar scroll", async () => {
  const [component, css] = await Promise.all([
    read("components/operations-schedules-preview.tsx"),
    read("components/ui/schedule-calendar.module.css"),
  ]);

  assert.match(css, /\.primary \{[^}]*border-radius:\s*var\(--panel-inner-radius\)[^}]*\}/u);
  assert.match(css, /\.primary \{[^}]*overflow:\s*clip;/u);
  assert.match(css, /\.detail \{[^}]*overflow-y:\s*auto;/u);
  assert.match(css, /\.calendarBody \{[^}]*overflow:\s*auto;/u);
  assert.match(css, /\.weekdayHeader \{[^}]*position:\s*sticky;[^}]*top:\s*0;/u);
  assert.doesNotMatch(css, /\.primary \{\s*overflow:\s*(?:auto|scroll|hidden)/u);
  assert.match(component, /<DetailInspector className=\{styles\.detail\}/u);
  assert.match(component, /<DetailInspectorHeader[\s\S]*<PanelFrameInfo label="View schedule technical details">/u);
  assert.match(component, /<PanelFrameInfoList>[\s\S]*<PanelFrameInfoFact key=\{key\} label=\{key\}>/u);
  assert.match(component, /<DetailInspectorBody>[\s\S]*<DetailFactGrid>[\s\S]*<DetailSection label="last observed run">/u);
  assert.doesNotMatch(component, /<aside className=\{styles\.detail\}|<details><summary>Technical identity/u);
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
  assert.match(component, /!schedules\.length \? <InlineNotice className=\{styles\.scheduleNotice\}/u);
  assert.doesNotMatch(component, /<ScheduleCalendar schedules=\{\[\]\}/u);
  assert.doesNotMatch(component, /CALENDAR_ITEMS_MOCK|Add Event/u);
  assert.match(component, /className=\{styles\.scheduleNotice\} data-availability="unavailable" density="spacious"/u);
  assert.match(css, /\.scheduleNotice \{[^}]*margin:\s*16px;/u);
  assert.doesNotMatch(css, /\.scheduleNotice \{[^}]*min-height:/u);
  assert.doesNotMatch(css, /\.unavailableCalendar|\.emptyResult|\.availabilityNotice/u);
});
