import type { ScheduleCalendarGroupV1, ScheduleCalendarView } from "../../../lib/schedule-calendar";
import type { ScheduleProjectionV1 } from "../../../lib/schedule-projection";

export type InspectScheduleGroups = (
  label: string,
  groups: ScheduleCalendarGroupV1[],
  index?: number,
) => void;

export interface CalendarViewProps {
  schedules: readonly ScheduleProjectionV1[];
  date: string;
  selectedIdentity: string | null;
  compact: boolean;
  onDate: (date: string, view: ScheduleCalendarView) => void;
  onInspect: InspectScheduleGroups;
}
