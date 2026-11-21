// The candle chart's period pin (widgets/paper/candleView.ts): a pinned period survives any zoom, Auto re-picks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { periodFor, pin, pinned, settledPeriod, PERIODS, periodName } = await namespace("widgets/paper/candleView.ts");

test("a pinned period stays after a zoom that Auto would regroup", () => {
  const range = { from: 0, to: 400 };
  // 15m candles squeezed to 1 px: Auto takes a longer period, a pin keeps an hour.
  assert.notEqual(periodFor(1, 900, range), 900);
  assert.equal(settledPeriod(null, 1, 900, range), periodFor(1, 900, range));
  assert.equal(settledPeriod(60, 1, 3600, range), 3600);
  assert.equal(settledPeriod(60, 40, 3600, range), 3600);
});

test("a pin is kept per chart key until Auto is chosen", () => {
  assert.equal(pinned("rsi@3/BTCUSDT"), null);
  pin("rsi@3/BTCUSDT", 60);
  assert.equal(pinned("rsi@3/BTCUSDT"), 60);
  assert.equal(pinned("rsi@3/ETHUSDT"), null);
  pin("rsi@3/BTCUSDT", null);
  assert.equal(pinned("rsi@3/BTCUSDT"), null);
});

test("the choices are Binance's periods by name", () => {
  assert.deepEqual(PERIODS.map((s) => periodName(s / 60)), ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"]);
});
