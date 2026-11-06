package main

// The whole market, beyond the perpetuals: total market cap and Bitcoin's share (CoinGecko), the Fear &
// Greed Index (alternative.me), the supply of USD stablecoins (DefiLlama), Bitcoin's premium on Coinbase
// and in Korea over Binance, Bitcoin options on Deribit, and an altcoin season index of our own: how many
// of the largest coins beat Bitcoin over 90 days. Changes and premiums are in percent.

import (
	"math"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MaxPain is the nearest Friday expiry (`YYYY-MM-DD`, 08:00 UTC) and the strike that pays its holders least.
type MaxPain struct {
	Expiry string  `json:"expiry"`
	Strike float64 `json:"strike"`
}

// Options is Bitcoin's options: open interest in USD at the index price, calls and puts, and puts' open
// interest over calls'.
type Options struct {
	OI      float64  `json:"oi"`
	PutCall *float64 `json:"putCall"`
	MaxPain *MaxPain `json:"maxPain"`
}

// FearGreed is alternative.me's index.
type FearGreed struct {
	Value float64 `json:"value"`
	Label string  `json:"label"`
}

// Stablecoins is USD stablecoins in circulation, and the change over a week of those reported a week ago.
type Stablecoins struct {
	Supply   float64  `json:"supply"`
	Change7d *float64 `json:"change7d"`
}

// Altseason is, of `coins` among the largest with 90 days of history, the share in percent that rose more
// than Bitcoin.
type Altseason struct {
	Index float64 `json:"index"`
	Coins int     `json:"coins"`
}

// Global is the whole market's readings. DVOL is Deribit's implied volatility index of Bitcoin, its last
// hourly close.
type Global struct {
	MarketCap          *float64     `json:"marketCap"`
	MarketCapChange24h *float64     `json:"marketCapChange24h"`
	BTCShare           *float64     `json:"btcShare"`
	FearGreed          *FearGreed   `json:"fearGreed"`
	Stablecoins        *Stablecoins `json:"stablecoins"`
	CoinbasePremium    *float64     `json:"coinbasePremium"`
	KoreaPremium       *float64     `json:"koreaPremium"`
	Options            *Options     `json:"options"`
	DVOL               *float64     `json:"dvol"`
	Altseason          *Altseason   `json:"altseason"`
}

// marketCap reads CoinGecko `GET /global`, into the three fields it gives.
func marketCap(body any, into *Global) {
	d := field(body, "data")
	into.MarketCap = num(field(d, "total_market_cap", "usd"))
	into.MarketCapChange24h = num(field(d, "market_cap_change_percentage_24h_usd"))
	into.BTCShare = num(field(d, "market_cap_percentage", "btc"))
}

// fearGreed reads alternative.me `GET /fng/?limit=1`.
func fearGreed(body any) *FearGreed {
	d := item(field(body, "data"), 0)
	value := num(field(d, "value"))
	label, ok := field(d, "value_classification").(string)
	if value == nil || !ok {
		return nil
	}
	return &FearGreed{*value, label}
}

// stablecoins reads DefiLlama `GET /stablecoins`: the USD-pegged coins' circulation now, and its change over
// a week among the coins that report one (a coin without last week's figure would read as growth).
func stablecoins(body any) (*Stablecoins, error) {
	assets, err := optional(field(body, "peggedAssets"))
	if err != nil {
		return nil, err
	}
	var supply, now, before float64
	found := false
	each(assets, func(a obj) {
		if a["pegType"] != "peggedUSD" {
			return
		}
		found = true
		c, w := orZero(num(field(a["circulating"], "peggedUSD"))), num(field(a["circulatingPrevWeek"], "peggedUSD"))
		supply += c
		if truthy(w) {
			now += c
			before += *w
		}
	})
	if !found {
		return nil, nil
	}
	read := &Stablecoins{Supply: supply}
	if before != 0 {
		read.Change7d = of((now/before - 1) * 100)
	}
	return read, nil
}

// coinbasePremium is Coinbase's BTC-USD over Binance's BTCUSDT in dollars (Tether at Kraken's USDT/USD), in
// percent. Kraken answers one pair, under a name of its own.
func coinbasePremium(coinbase, binance, kraken any) *float64 {
	var pair any
	if result, ok := field(kraken, "result").(obj); ok && len(result) > 0 {
		names := make([]string, 0, len(result))
		for name := range result {
			names = append(names, name)
		}
		sort.Strings(names)
		pair = result[names[0]]
	}
	usd, usdt, tether := num(field(coinbase, "price")), num(field(binance, "price")), num(item(field(pair, "c"), 0))
	if !truthy(usd) || !truthy(usdt) || !truthy(tether) {
		return nil
	}
	return of((*usd/(*usdt**tether) - 1) * 100)
}

// koreaPremium is Upbit's BTC over Binance's, both in Tether (Upbit's KRW-BTC over its KRW-USDT), in percent.
func koreaPremium(upbit, binance any) (*float64, error) {
	list, err := rows(upbit)
	if err != nil {
		return nil, err
	}
	krw := func(market string) *float64 {
		for _, r := range list {
			if field(r, "market") == market {
				return num(field(r, "trade_price"))
			}
		}
		return nil
	}
	btc, tether, usdt := krw("KRW-BTC"), krw("KRW-USDT"), num(field(binance, "price"))
	if !truthy(btc) || !truthy(tether) || !truthy(usdt) {
		return nil, nil
	}
	return of((*btc / *tether / *usdt - 1) * 100), nil
}

var (
	expiryCode = regexp.MustCompile(`^(\d{1,2})([A-Z]{3})(\d{2})$`)
	months     = []string{"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"}
)

// expiryDate is `6NOV26` as `2026-11-06`, "" for anything else.
func expiryDate(code string) string {
	m := expiryCode.FindStringSubmatch(code)
	if m == nil {
		return ""
	}
	month := slices.Index(months, m[2])
	if month < 0 {
		return ""
	}
	day, _ := strconv.Atoi(m[1])
	year, _ := strconv.Atoi(m[3])
	return time.Date(2000+year, time.Month(month+1), day, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
}

type option struct {
	Expiry string
	Strike float64
	Put    bool
	OI     float64
}

// maxPainStrike is the strike at which an expiry's options pay their holders least: calls below it and puts
// above it finish in the money. Nil without options.
func maxPainStrike(options []option) *float64 {
	strikes := make([]float64, 0, len(options))
	for _, o := range options {
		strikes = append(strikes, o.Strike)
	}
	slices.Sort(strikes)
	strikes = slices.Compact(strikes)
	var best *float64
	least := math.Inf(1)
	for _, at := range strikes {
		paid := 0.0
		for _, o := range options {
			pays := at - o.Strike
			if o.Put {
				pays = o.Strike - at
			}
			paid += o.OI * math.Max(0, pays)
		}
		if paid < least {
			least, best = paid, of(at)
		}
	}
	return best
}

// bitcoinOptions reads Deribit `GET public/get_book_summary_by_currency?currency=BTC&kind=option`.
func bitcoinOptions(body any) (*Options, error) {
	list, err := optional(field(body, "result"))
	if err != nil {
		return nil, err
	}
	var read []option
	var index *float64
	each(list, func(r obj) {
		if index == nil {
			index = num(r["estimated_delivery_price"])
		}
		name, _ := str(r, "instrument_name")
		parts := strings.Split(name, "-")
		if len(parts) < 4 {
			return
		}
		expiry, k, oi, side := expiryDate(parts[1]), num(parts[2]), num(r["open_interest"]), parts[3]
		if expiry != "" && k != nil && oi != nil && (side == "C" || side == "P") {
			read = append(read, option{expiry, *k, side == "P", *oi})
		}
	})
	if len(read) == 0 || index == nil {
		return nil, nil
	}
	var calls, puts float64
	expiries := map[string]bool{}
	for _, o := range read {
		expiries[o.Expiry] = true
		if o.Put {
			puts += o.OI
		} else {
			calls += o.OI
		}
	}
	dates := make([]string, 0, len(expiries))
	for e := range expiries {
		dates = append(dates, e)
	}
	sort.Strings(dates)
	out := &Options{OI: (calls + puts) * *index}
	if calls != 0 {
		out.PutCall = of(puts / calls)
	}
	for _, e := range dates {
		if day, err := time.Parse(time.DateOnly, e); err == nil && day.Weekday() == time.Friday {
			var that []option
			for _, o := range read {
				if o.Expiry == e {
					that = append(that, o)
				}
			}
			if strike := maxPainStrike(that); strike != nil {
				out.MaxPain = &MaxPain{e, *strike}
			}
			break
		}
	}
	return out, nil
}

// dvol reads Deribit `GET public/get_volatility_index_data`: the last row's close.
func dvol(body any) *float64 {
	return num(item(item(field(body, "result", "data"), -1), 4))
}

// seasonDays is how many days back the index compares.
const seasonDays = 90

// seasonChange is a coin's change over the window of its daily klines (Binance, `limit=seasonDays + 1`): the
// last close over the first; nil without the whole window.
func seasonChange(klines any) (*float64, error) {
	list, err := rows(klines)
	if err != nil {
		return nil, err
	}
	if len(list) < seasonDays+1 {
		return nil, nil
	}
	first, last := num(item(list[0], 4)), num(item(list[len(list)-1], 4))
	if !truthy(first) || !truthy(last) {
		return nil, nil
	}
	return of(*last / *first - 1), nil
}

// altseason is, of the coins' changes (nil: too young), the share in percent above Bitcoin's.
func altseason(btc *float64, changes []*float64) *Altseason {
	known, above := 0, 0
	for _, c := range changes {
		if c != nil {
			known++
			if btc != nil && *c > *btc {
				above++
			}
		}
	}
	if btc == nil || known == 0 {
		return nil
	}
	return &Altseason{math.Round(float64(above) / float64(known) * 100), known}
}
