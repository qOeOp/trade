package main

// CoinGecko without a key: each Binance contract's coin id (from CoinGecko's own Binance Futures tickers,
// with a fix for the contracts it maps wrongly), each coin's market cap, FDV and name, and the coins of a
// category (for the sub-sectors).

import "sort"

// Cap is a coin's name, market cap and FDV in USD.
type Cap struct {
	Name      string
	MarketCap *float64
	FDV       *float64
}

// idFixes are the contracts CoinGecko's tickers map to the wrong coin (measured 2026-11-02).
var idFixes = map[string]string{
	"1000SHIBUSDT": "shiba-inu", "1000BONKUSDT": "bonk", "1000RATSUSDT": "rats", "1000SATSUSDT": "sats-ordinals",
}

// geckoPage is the ids per `/coins/markets` request, its largest page.
const geckoPage = 250

// coinIDs reads `GET /derivatives/exchanges/binance_futures?include_tickers=unexpired`: contract symbol to
// coin id.
func coinIDs(exchange any) (map[string]string, error) {
	list, err := optional(field(exchange, "tickers"))
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	each(list, func(t obj) {
		symbol, isSymbol := str(t, "symbol")
		id, _ := str(t, "coin_id")
		if t["contract_type"] == "perpetual" && isSymbol && id != "" {
			out[symbol] = id
		}
	})
	for symbol, id := range idFixes {
		out[symbol] = id
	}
	return out, nil
}

// pages is the distinct ids in groups of at most geckoPage, in a stable order.
func pages(ids []string) [][]string {
	seen := map[string]bool{}
	var all []string
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			all = append(all, id)
		}
	}
	sort.Strings(all)
	var out [][]string
	for i := 0; i < len(all); i += geckoPage {
		out = append(out, all[i:min(i+geckoPage, len(all))])
	}
	return out
}

// members reads `GET /coins/markets?vs_currency=usd&category=…`: the ids of a category's coins, largest
// first.
func members(body any) ([]string, error) {
	list, err := rows(body)
	if err != nil {
		return nil, err
	}
	var out []string
	each(list, func(r obj) {
		if id, ok := str(r, "id"); ok {
			out = append(out, id)
		}
	})
	return out, nil
}

func amount(v any) *float64 {
	if f, ok := v.(float64); ok && f > 0 {
		return &f
	}
	return nil
}

// caps reads `GET /coins/markets?vs_currency=usd&ids=…`: coin id to name, market cap and FDV in USD.
func caps(body any) (map[string]Cap, error) {
	list, err := rows(body)
	if err != nil {
		return nil, err
	}
	out := map[string]Cap{}
	each(list, func(r obj) {
		id, ok := str(r, "id")
		if !ok {
			return
		}
		name, named := str(r, "name")
		if !named {
			name = id
		}
		out[id] = Cap{name, amount(r["market_cap"]), amount(r["fully_diluted_valuation"])}
	})
	return out, nil
}
