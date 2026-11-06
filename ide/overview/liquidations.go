package main

// Forced liquidations. Binance, Bybit and OKX have no free history of them and only push them as they
// happen, so the overview records those pushes from when it connects and keeps the last 24 hours. Bybit
// pushes every one; Binance at most one a contract a second and OKX throttled, so theirs undercount, and
// OKX's REST list of recent ones fills in its throttled pushes. Gate's hourly contract stats go back far
// enough for a whole day of its own. A side is the position closed: a long liquidated is sold.

import (
	"strings"
)

// liquidationVenues push their liquidations.
var liquidationVenues = []string{"Binance", "Bybit", "OKX"}

// Sides is a sum of liquidations in USD, the positions closed.
type Sides struct {
	Long  float64 `json:"long"`
	Short float64 `json:"short"`
}

func (s *Sides) add(long bool, usd float64) {
	if long {
		s.Long += usd
	} else {
		s.Short += usd
	}
}

// Liquidation is one liquidation: where, the contract there and its coin, the side closed, its value in USD,
// when (milliseconds) and what tells a repeat of it apart.
type Liquidation struct {
	Venue, Market, Coin string
	Long                bool
	USD, At             float64
	Key                 string
}

func keyed(parts ...string) string { return strings.Join(parts, "|") }

// fromBybit reads Bybit `allLiquidation.{symbol}`: `S` Buy is a long position liquidated, `v` coins at `p`.
func fromBybit(message any) []Liquidation {
	topic, _ := field(message, "topic").(string)
	data, isList := field(message, "data").([]any)
	if !strings.HasPrefix(topic, "allLiquidation.") || !isList {
		return nil
	}
	var out []Liquidation
	each(data, func(d obj) {
		v, p, at := num(d["v"]), num(d["p"]), num(d["T"])
		s, isSymbol := str(d, "s")
		side, _ := str(d, "S")
		if !isSymbol || !strings.HasSuffix(s, "USDT") || v == nil || p == nil || at == nil || (side != "Buy" && side != "Sell") {
			return
		}
		if usd := finite(*v * *p); usd != nil {
			out = append(out, Liquidation{"Bybit", s, coinKey(strings.TrimSuffix(s, "USDT")), side == "Buy", *usd, *at,
				keyed(s, plainNumber(*at), side, written(d["v"]), written(d["p"]))})
		}
	})
	return out
}

// fromBinance reads Binance `!forceOrder@arr`: the liquidation's order, SELL closing a long, `z` coins filled
// at `ap`.
func fromBinance(message any) []Liquidation {
	o, ok := field(message, "o").(obj)
	if field(message, "e") != "forceOrder" || !ok {
		return nil
	}
	z, ap, at := num(o["z"]), num(o["ap"]), num(o["T"])
	s, isSymbol := str(o, "s")
	side, _ := str(o, "S")
	if !isSymbol || !strings.HasSuffix(s, "USDT") || !truthy(z) || ap == nil || at == nil || (side != "SELL" && side != "BUY") {
		return nil
	}
	usd := finite(*z * *ap)
	if usd == nil {
		return nil
	}
	return []Liquidation{{"Binance", s, coinKey(strings.TrimSuffix(s, "USDT")), side == "SELL", *usd, *at,
		keyed(s, plainNumber(*at), side, written(o["z"]))}}
}

// okxContractValues reads OKX `GET /api/v5/public/instruments?instType=SWAP`: the coins one contract holds,
// for each USDT one.
func okxContractValues(body any) (map[string]float64, error) {
	list, err := optional(field(body, "data"))
	if err != nil {
		return nil, err
	}
	out := map[string]float64{}
	each(list, func(r obj) {
		v := num(r["ctVal"])
		if id, ok := str(r, "instId"); ok && strings.HasSuffix(id, "-USDT-SWAP") && truthy(v) {
			out[id] = *v
		}
	})
	return out, nil
}

// fromOKX reads OKX `liquidation-orders`, pushed or from `GET /api/v5/public/liquidation-orders` (the same
// rows): each contract's liquidations, `sz` contracts at the bankruptcy price; `posSide` names the side
// closed, or in net mode a sell closes a long. A contract without a known size is left out.
func fromOKX(body any, values map[string]float64) []Liquidation {
	data, isList := field(body, "data").([]any)
	if !isList {
		return nil
	}
	var out []Liquidation
	each(data, func(r obj) {
		id, ok := str(r, "instId")
		details, isList := r["details"].([]any)
		value := values[id]
		if !ok || !isList || value == 0 {
			return
		}
		each(details, func(d obj) {
			sz, px, at := num(d["sz"]), num(d["bkPx"]), num(d["ts"])
			posSide, _ := str(d, "posSide")
			side, _ := str(d, "side")
			var long bool
			switch {
			case posSide == "long" || posSide == "short":
				long = posSide == "long"
			case side == "sell" || side == "buy":
				long = side == "sell"
			default:
				return
			}
			if sz == nil || px == nil || at == nil {
				return
			}
			if usd := finite(*sz * value * *px); usd != nil {
				out = append(out, Liquidation{"OKX", id, coinKey(strings.SplitN(id, "-", 2)[0]), long, *usd, *at,
					keyed(id, plainNumber(*at), written(d["side"]), written(d["sz"]), written(d["bkPx"]))})
			}
		})
	})
	return out
}

// gateDay reads Gate `GET /api/v4/futures/usdt/contract_stats?interval=1h`: the long and short liquidations
// in USD of the hours that began within the last day.
func gateDay(body any, now float64) (Sides, error) {
	list, err := rows(body)
	if err != nil {
		return Sides{}, err
	}
	var sides Sides
	each(list, func(r obj) {
		if t := num(r["time"]); t != nil && *t*1000 > now-dayMS {
			sides.Long += orZero(num(r["long_liq_usd"]))
			sides.Short += orZero(num(r["short_liq_usd"]))
		}
	})
	return sides, nil
}

// Liquidations holds the pushed liquidations of the last 24 hours, each once, and when each venue's
// recording began. The store's lock guards it.
type Liquidations struct {
	since  map[string]float64
	events []Liquidation
	keys   map[string]bool
	now    func() int64
}

func newLiquidations(now func() int64) *Liquidations {
	return &Liquidations{since: map[string]float64{}, keys: map[string]bool{}, now: now}
}

// started marks a venue's recording begun, the first time it connects.
func (l *Liquidations) started(venue string) {
	if _, ok := l.since[venue]; !ok {
		l.since[venue] = float64(l.now())
	}
}

func (l *Liquidations) add(list []Liquidation) {
	l.prune()
	from := float64(l.now()) - dayMS
	for _, e := range list {
		if e.At < from || l.keys[e.Key] {
			continue
		}
		l.keys[e.Key] = true
		l.events = append(l.events, e)
	}
}

// markets is the contracts on `venue` with a liquidation since `from`.
func (l *Liquidations) markets(venue string, from float64) []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range l.events {
		if e.Venue == venue && e.At >= from && !seen[e.Market] {
			seen[e.Market] = true
			out = append(out, e.Market)
		}
	}
	return out
}

// byCoin is each coin's liquidations of the last 24 hours, by venue.
func (l *Liquidations) byCoin() map[string]map[string]*Sides {
	l.prune()
	out := map[string]map[string]*Sides{}
	for _, e := range l.events {
		venues := out[e.Coin]
		if venues == nil {
			venues = map[string]*Sides{}
			out[e.Coin] = venues
		}
		sides := venues[e.Venue]
		if sides == nil {
			sides = &Sides{}
			venues[e.Venue] = sides
		}
		sides.add(e.Long, e.USD)
	}
	return out
}

func (l *Liquidations) prune() {
	from := float64(l.now()) - dayMS
	stale := false
	for i := range l.events {
		if l.events[i].At < from {
			stale = true
			break
		}
	}
	if !stale {
		return
	}
	kept := make([]Liquidation, 0, len(l.events))
	keys := make(map[string]bool, len(l.keys))
	for _, e := range l.events {
		if e.At >= from {
			kept = append(kept, e)
			keys[e.Key] = true
		}
	}
	l.events, l.keys = kept, keys
}
