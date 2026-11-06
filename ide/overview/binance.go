package main

// Binance USDⓈ-M public market data, keyed by symbol: the readers of `ticker/24hr`, `premiumIndex` and
// `fundingInfo` (all symbols in one request each), and of the per-contract open interest history, klines
// and long/short ratio.

import "math"

// Quote is a contract's latest price, its rolling 24h change in percent and quote volume in USDT.
type Quote struct {
	Price     float64 `json:"price"`
	Change24h float64 `json:"change24h"`
	Volume24h float64 `json:"volume24h"`
}

// quotes reads `GET /fapi/v1/ticker/24hr`.
func quotes(body any) (map[string]Quote, error) {
	list, err := rows(body)
	if err != nil {
		return nil, err
	}
	out := map[string]Quote{}
	each(list, func(r obj) {
		price, change24h, volume24h := num(r["lastPrice"]), num(r["priceChangePercent"]), num(r["quoteVolume"])
		if symbol, ok := str(r, "symbol"); ok && price != nil && change24h != nil && volume24h != nil {
			out[symbol] = Quote{*price, *change24h, *volume24h}
		}
	})
	return out, nil
}

// fundingRates reads `GET /fapi/v1/premiumIndex`: the funding rate of the current period, as a fraction.
func fundingRates(body any) (map[string]float64, error) {
	return bySymbol(body, "lastFundingRate", func(*float64) bool { return true })
}

// fundingIntervals reads `GET /fapi/v1/fundingInfo`: the contracts whose funding period is not the usual
// eight hours.
func fundingIntervals(body any) (map[string]float64, error) {
	return bySymbol(body, "fundingIntervalHours", truthy)
}

func bySymbol(body any, key string, keep func(*float64) bool) (map[string]float64, error) {
	list, err := rows(body)
	if err != nil {
		return nil, err
	}
	out := map[string]float64{}
	each(list, func(r obj) {
		v := num(r[key])
		if symbol, ok := str(r, "symbol"); ok && v != nil && keep(v) {
			out[symbol] = *v
		}
	})
	return out, nil
}

// Interest is the open interest in USDT and its change in percent over 24 hours.
type Interest struct {
	OI          float64
	OIChange24h *float64
}

const dayMS = 86_400_000.0

// interest reads `GET /futures/data/openInterestHist?period=5m&limit=289`: the open interest at its last
// five minutes, and its change from 24 hours before (nil while the history is shorter). Nil without one.
func interest(body any) (*Interest, error) {
	list, err := rows(body)
	if err != nil {
		return nil, err
	}
	last, first := item(list, -1), item(list, 0)
	now, then := num(field(last, "sumOpenInterestValue")), num(field(first, "sumOpenInterestValue"))
	if now == nil {
		return nil, nil
	}
	read := &Interest{OI: *now}
	if orZero(num(field(last, "timestamp")))-orZero(num(field(first, "timestamp"))) >= dayMS-10*60_000 && truthy(then) {
		read.OIChange24h = of((*now / *then - 1) * 100)
	}
	return read, nil
}

// Moves holds the closes an hour, four hours and seven days back, each within a kline of it: the snapshot
// measures the price's change in each window from these against the latest quote.
type Moves struct{ Back1h, Back4h, Back7d *float64 }

// Line is the hourly closes of the last seven days: [open time in seconds, close].
type Line [][2]float64

func back(klines []any, n int) *float64 {
	if len(klines) <= n {
		return nil
	}
	return num(item(klines[len(klines)-1-n], 4))
}

// moves reads `klines` at 5m (limit 49) and 1h (limit 169), the last kline of each the one still forming:
// the closes the windows start from, and the hourly closes for the coin's seven-day line.
func moves(fiveMinute, hourly any) (Moves, Line, error) {
	five, err := rows(fiveMinute)
	if err != nil {
		return Moves{}, nil, err
	}
	hours, err := rows(hourly)
	if err != nil {
		return Moves{}, nil, err
	}
	line := make(Line, 0, len(hours))
	for _, k := range hours {
		if c := num(item(k, 4)); c != nil {
			line = append(line, [2]float64{math.Floor(orZero(num(item(k, 0))) / 1000), *c})
		}
	}
	return Moves{back(five, 12), back(five, 48), back(hours, 168)}, line, nil
}

// change is the change in percent from `back` to `price`; nil without a close to start from.
func change(price float64, back *float64) *float64 {
	if !truthy(back) {
		return nil
	}
	return of((price / *back - 1) * 100)
}

// longShort reads `GET /futures/data/globalLongShortAccountRatio?period=5m&limit=1`: accounts long over
// accounts short.
func longShort(body any) (*float64, error) {
	list, err := rows(body)
	if err != nil {
		return nil, err
	}
	return num(field(item(list, -1), "longShortRatio")), nil
}
