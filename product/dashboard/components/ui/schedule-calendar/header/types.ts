import type {
  ScheduleCalendarView,
  ScheduleObservationScope,
} from "../../../../lib/schedule-calendar";

export interface CalendarHeaderProps {
  date: string;
  view: ScheduleCalendarView;
  mode: "calendar" | "table";
  pending: boolean;
  statusLabel: string;
  query: string;
  observationScope: ScheduleObservationScope;
  operationScope: string;
  operations: readonly string[];
  compactCalendar: boolean;
  onToday: () => void;
  onShift: (offset: number) => void;
  onView: (view: ScheduleCalendarView) => void;
  onQuery: (query: string) => void;
  onObservationScope: (scope: ScheduleObservationScope) => void;
  onOperationScope: (scope: string) => void;
  onRefresh: () => void;
  onCompactCalendar: (compact: boolean) => void;
  onToggleTable: () => void;
}
