export type ScheduleAvailabilityPresentationV1 = {
  title: string;
  summaryValue: "Expired" | "Not configured" | "Unavailable" | "Reading";
  detail: string;
};

const presentations: Readonly<Record<string, ScheduleAvailabilityPresentationV1>> = {
  READING_SCHEDULES: {
    title: "Reading schedule custody",
    summaryValue: "Reading",
    detail: "Waiting for one exact status-only schedule projection.",
  },
  SCHEDULE_COMPATIBILITY_UNAVAILABLE: {
    title: "Schedule compatibility expired",
    summaryValue: "Expired",
    detail: "The configured read schedule set is retained, but its finite Owner compatibility evidence is unavailable or expired. An operator must supply a fresh evidence cut before another due cut can be enqueued.",
  },
  SCHEDULE_CONFIGURATION_UNAVAILABLE: {
    title: "Schedule set not configured",
    summaryValue: "Not configured",
    detail: "No content-addressed zero-effect read schedule set is admitted for this Dashboard instance.",
  },
  RUN_STORE_CONFIGURATION_UNAVAILABLE: {
    title: "RunStore not configured",
    summaryValue: "Unavailable",
    detail: "Schedule definitions cannot be joined to durable due-cut history without the first-party RunStore binding.",
  },
  SCHEDULE_STORE_UNAVAILABLE: {
    title: "Schedule store unavailable",
    summaryValue: "Unavailable",
    detail: "The verified schedule and due-cut projection could not be read. No scheduler action was inferred from this failure.",
  },
  MALFORMED_SCHEDULE_RESPONSE: {
    title: "Schedule response rejected",
    summaryValue: "Unavailable",
    detail: "The response did not satisfy the exact schedule projection contract, so its rows were withheld.",
  },
};

const fallback: ScheduleAvailabilityPresentationV1 = {
  title: "Schedule projection unavailable",
  summaryValue: "Unavailable",
  detail: "The schedule projection failed closed with an unrecognized bounded reason. No schedule state or action was inferred.",
};

export function scheduleAvailabilityPresentationV1(
  reason: string | null | undefined,
): ScheduleAvailabilityPresentationV1 {
  return presentations[reason ?? "READING_SCHEDULES"] ?? fallback;
}
