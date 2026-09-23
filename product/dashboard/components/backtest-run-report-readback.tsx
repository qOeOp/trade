"use client";

import { useEffect, useState } from "react";

import {
  normalizeBacktestRunReport,
  unavailableBacktestRunReport,
  type BacktestRunReport as BacktestRunReportProjection,
  type BacktestRunReportLocator,
} from "../lib/backtest-run-report-contract";
import { encodeExploratoryReplayOpaqueIdentityV2 } from "../lib/exploratory-replay-identity";
import { BacktestRunReport } from "./backtest-run-report";

export const BACKTEST_RUN_REPORT_TRANSPORT_UNAVAILABLE = "BACKTEST_RUN_REPORT_TRANSPORT_UNAVAILABLE";

// Reads the report for the one result the `/backtest` lookup opened. The caller keys this by the
// locator, so a new result mounts a new read and an answer for an earlier one can never land here.
export function BacktestRunReportReadback({
  locator: { result_identity, request_identity, attempt_identity },
}: {
  locator: BacktestRunReportLocator;
}) {
  const [report, setReport] = useState<BacktestRunReportProjection>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const locator = { result_identity, request_identity, attempt_identity };
    const encoded = [result_identity, request_identity, attempt_identity]
      .map(encodeExploratoryReplayOpaqueIdentityV2);
    if (encoded.some((value) => !value)) {
      setReport(unavailableBacktestRunReport());
      return () => controller.abort();
    }
    const query = new URLSearchParams({
      resultIdentityB64: encoded[0]!,
      requestIdentityB64: encoded[1]!,
      attemptIdentityB64: encoded[2]!,
    });
    fetch(`/api/backtest/run-reports?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((body: unknown) => {
        if (!controller.signal.aborted) setReport(normalizeBacktestRunReport(body, locator));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReport(unavailableBacktestRunReport(BACKTEST_RUN_REPORT_TRANSPORT_UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, [result_identity, request_identity, attempt_identity]);

  return <BacktestRunReport report={report} />;
}
