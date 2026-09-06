"use client";

import type { CalendarViewProps } from "../../types";
import { CalendarTimeGrid } from "./calendar-time-view";

export function CalendarDayView(props: CalendarViewProps) {
  return <CalendarTimeGrid {...props} view="day" />;
}
