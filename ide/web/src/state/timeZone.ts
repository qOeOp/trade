import { isTimeZone, type TimeZone } from "../lib/time";
import { persistedAtom, useAtom } from "./atom";

export const timeZone = persistedAtom<TimeZone>("rg-time-zone", "UTC", isTimeZone);
export const useTimeZone = () => useAtom(timeZone);
