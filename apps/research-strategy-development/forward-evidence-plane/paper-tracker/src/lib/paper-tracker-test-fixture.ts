export function forwardReportFixture(manifestPath: string) {
  return {
    ok: true,
    data: {
      strategy_id: "S-TEST",
      setup_id: "setup",
      frozen_at: "2026-07-09T01:15:07.000Z",
      now: "2026-07-09T04:10:00.000Z",
      timeframe: "4h",
      frozen_candidate: {
        candidate_id: "C-1",
        family: "time_series_momentum_v1",
        parameter_count: 8,
        candidate_hash: "abc",
      },
      records: [{
        dataset_id: "ALT",
        manifest_path: manifestPath,
        symbol: "ALTUSDT",
        latest_candle_open: "2026-07-09T00:00:00.000Z",
        latest_candle_closed_at: "2026-07-09T04:00:00.000Z",
        eligible: true,
        blocked_by: [],
        signal: {
          candidate_id: "C-1",
          candidate_hash: "abc",
          strategy_id: "S-TEST",
          symbol: "ALTUSDT",
          timeframe: "4h",
          signal_time: "2026-07-09T00:00:00.000Z",
          entry_reference: 100,
          action: "entry",
          signal: {
            side: "short",
            signal_index: 0,
            entry_index: 1,
            entry: 100,
            stop: 105,
            target: 90,
            break_even_after_r: 0.5,
            break_even_offset_r: 0,
            reason: "test",
          },
        },
      }],
    },
  }
}
