"use client";

import type { CalendarViewProps } from "../../types";
import { CalendarTimeGrid } from "./calendar-time-view";

export function CalendarWeekView(props: CalendarViewProps) {
  return <CalendarTimeGrid {...props} view="week" />;
}
