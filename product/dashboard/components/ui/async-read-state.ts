export type AsyncReadAvailability = "idle" | "loading" | "available" | "unavailable";

export function visibleAsyncReadAvailabilityV1(
  enabled: boolean,
  availability: AsyncReadAvailability,
): AsyncReadAvailability {
  return enabled && availability === "idle" ? "loading" : availability;
}
