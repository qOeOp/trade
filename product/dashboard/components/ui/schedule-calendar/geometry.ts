export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const dayKey = (value: number) => new Date(value).toISOString().slice(0, 10);
export const timeLabel = (value: string) => value.slice(11, 16);

export function fullWeekRange(start: number, end: number) {
  return {
    start: start - new Date(start).getUTCDay() * DAY_MS,
    end: end + ((7 - new Date(end).getUTCDay()) % 7) * DAY_MS,
  };
}
