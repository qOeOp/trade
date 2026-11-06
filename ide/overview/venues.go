package main

// The other exchanges' USDT perpetuals (Hyperliquid's USDC ones), each from its whole-market endpoints
// (one request each, no key): open interest in USD, the funding rate of the current period and how many
// hours that period lasts, keyed by coin so a Binance contract finds its counterparts (coinKey).

import "strings"

// Market is a coin on one exchange.
type Market struct {
	OI            *float64 `json:"oi"`
	Funding       *float64 `json:"funding"`
	IntervalHours *float64 `json:"intervalHours"`
}

// venues are the other exchanges, in the page's order.
var venues = []string{"Bybit", "OKX", "Bitget", "Gate", "Hyperliquid"}

func times(vs ...*float64) *float64 {
	product := 1.0
	for _, v := range vs {
		if v == nil {
			return nil
		}
		product *= *v
	}
	return finite(product)
}

const hourMS = 3_600_000.0

// contractSizes are the sizes written into a symbol, before (1000PEPE, 1MBABYDOGE) or after (SHIB1000) the
// coin.
var contractSizes = []string{"1000000", "10000", "1000", "1M"}

// coinKey is the coin a contract's base trades, its size multiplier dropped: 1000PEPE, PEPE and SHIB1000's
// SHIB.
func coinKey(base string) string {
	for _, size := range contractSizes {
		if length(base) > len(size)+1 {
			if strings.HasPrefix(base, size) {
				return base[len(size):]
			}
			if strings.HasSuffix(base, size) {
				return base[:len(base)-len(size)]
			}
		}
	}
	return base
}

// coinMarkets gathers each coin's market; of two contracts on the same coin (PEPE and 1000PEPE) the one
// with more open interest.
type coinMarkets map[string]Market

func (out coinMarkets) add(base string, market Market) {
	key := coinKey(base)
	if had, ok := out[key]; !ok || orZero(market.OI) > orZero(had.OI) {
		out[key] = market
	}
}

// bybitMarkets reads `GET /v5/market/tickers?category=linear`: USDT contracts only (USDC ones end in PERP).
func bybitMarkets(list []any) map[string]Market {
	out := coinMarkets{}
	each(list, func(r obj) {
		if s, ok := str(r, "symbol"); ok && strings.HasSuffix(s, "USDT") && !strings.Contains(s, "-") {
			out.add(strings.TrimSuffix(s, "USDT"), Market{num(r["openInterestValue"]), num(r["fundingRate"]), num(r["fundingIntervalHour"])})
		}
	})
	return out
}

// okxMarkets reads `GET /api/v5/public/open-interest?instType=SWAP` and `public/funding-rate?instId=ANY`;
// the period is the time from the last funding to the coming one.
func okxMarkets(interest, funding []any) map[string]Market {
	rates := map[string]obj{}
	each(funding, func(r obj) {
		if id, ok := str(r, "instId"); ok {
			rates[id] = r
		}
	})
	out := coinMarkets{}
	each(interest, func(r obj) {
		id, ok := str(r, "instId")
		if !ok || !strings.HasSuffix(id, "-USDT-SWAP") {
			return
		}
		f := rates[id]
		at, before := num(f["fundingTime"]), num(f["prevFundingTime"])
		var hours *float64
		if truthy(at) && truthy(before) {
			hours = of((*at - *before) / hourMS)
		}
		out.add(strings.SplitN(id, "-", 2)[0], Market{num(r["oiUsd"]), num(f["fundingRate"]), hours})
	})
	return out
}

// bitgetMarkets reads `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` (open interest in coins,
// times the mark price) and its `contracts` (the funding period).
func bitgetMarkets(tickers, contracts []any) map[string]Market {
	hours := map[string]*float64{}
	each(contracts, func(c obj) {
		if s, ok := str(c, "symbol"); ok {
			hours[s] = num(c["fundInterval"])
		}
	})
	out := coinMarkets{}
	each(tickers, func(r obj) {
		if s, ok := str(r, "symbol"); ok && strings.HasSuffix(s, "USDT") {
			out.add(strings.TrimSuffix(s, "USDT"), Market{times(num(r["holdingAmount"]), num(r["markPrice"])), num(r["fundingRate"]), hours[s]})
		}
	})
	return out
}

// gateMarkets reads `GET /api/v4/futures/usdt/tickers` (open interest in contracts, times coins per
// contract and the mark price) and its `contracts` (the funding period in seconds).
func gateMarkets(tickers, contracts []any) map[string]Market {
	seconds := map[string]*float64{}
	each(contracts, func(c obj) {
		if s, ok := str(c, "name"); ok {
			seconds[s] = num(c["funding_interval"])
		}
	})
	out := coinMarkets{}
	each(tickers, func(r obj) {
		s, ok := str(r, "contract")
		if !ok || !strings.HasSuffix(s, "_USDT") {
			return
		}
		var hours *float64
		if truthy(seconds[s]) {
			hours = of(*seconds[s] / 3600)
		}
		out.add(strings.TrimSuffix(s, "_USDT"), Market{times(num(r["total_size"]), num(r["quanto_multiplier"]), num(r["mark_price"])), num(r["funding_rate"]), hours})
	})
	return out
}

// hyperliquidMarkets reads Hyperliquid's `info` query `metaAndAssetCtxs`: the listed perpetuals and, in the
// same order, each one's open interest in coins (times the mark price) and its funding rate, which it pays
// every hour. Delisted ones are left out; a `k` before the coin (kPEPE) means a thousand of it.
func hyperliquidMarkets(answer any) map[string]Market {
	out := coinMarkets{}
	universe, _ := field(item(answer, 0), "universe").([]any)
	contexts := item(answer, 1)
	for i, u := range universe {
		name, ok := field(u, "name").(string)
		c, hasContext := item(contexts, i).(obj)
		if delisted, _ := field(u, "isDelisted").(bool); !ok || delisted || !hasContext {
			continue
		}
		if len(name) > 1 && name[0] == 'k' && name[1] >= 'A' && name[1] <= 'Z' {
			name = name[1:]
		}
		out.add(name, Market{times(num(c["openInterest"]), num(c["markPx"])), num(c["funding"]), of(1)})
	}
	return out
}
