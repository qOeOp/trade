import { describe, expect, test } from "bun:test";
import { deriveNaturalSoakStatus } from "./natural-soak-status";

describe("natural soak status", () => {
  test("distinguishes startup, recent activity, stale activity, and completion", () => {
    expect(
      deriveNaturalSoakStatus({
        evidenceExists: false,
        supervisorAlive: true,
        observedAtMs: 2_000,
        startedAtMs: 1_000,
        staleAfterMs: 5_000,
      }).status,
    ).toBe("starting");
    expect(
      deriveNaturalSoakStatus({
        evidenceExists: false,
        supervisorAlive: true,
        observedAtMs: 10_000,
        startedAtMs: 1_000,
        latestDataModifiedAtMs: 9_000,
        staleAfterMs: 5_000,
      }).status,
    ).toBe("active");
    expect(
      deriveNaturalSoakStatus({
        evidenceExists: false,
        supervisorAlive: true,
        observedAtMs: 20_000,
        startedAtMs: 1_000,
        latestDataModifiedAtMs: 9_000,
        staleAfterMs: 5_000,
      }).status,
    ).toBe("stale");
    expect(
      deriveNaturalSoakStatus({
        evidenceExists: true,
        supervisorAlive: false,
        observedAtMs: 20_000,
        startedAtMs: 1_000,
        staleAfterMs: 5_000,
      }),
    ).toEqual({ status: "completed" });
    expect(
      deriveNaturalSoakStatus({
        evidenceExists: false,
        supervisorAlive: false,
        observedAtMs: 10_000,
        startedAtMs: 1_000,
        latestDataModifiedAtMs: 9_900,
        staleAfterMs: 5_000,
      }).status,
    ).toBe("failed");
    expect(
      deriveNaturalSoakStatus({
        evidenceExists: true,
        evidenceVerdict: "failed",
        supervisorAlive: false,
        observedAtMs: 10_000,
        startedAtMs: 1_000,
        staleAfterMs: 5_000,
      }).status,
    ).toBe("failed");
  });
});
