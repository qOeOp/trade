package main

// What the overview holds in memory, each kind of data on its own with when it last arrived and its last
// failure, and what the page reads: the snapshot of every coin, and one coin's details. A kind that fails
// keeps its last value: the page shows it as older, never as missing. Nothing is written anywhere.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"
)

// kinds lists each kind of data, in the order the answers name them.
var kinds = []string{"contracts", "quotes", "funding", "interest", "moves", "ratios", "ids", "caps", "members", "bybit", "okx", "bitget", "gate", "hyperliquid",
	"liquidations.binance", "liquidations.bybit", "liquidations.okx", "liquidations.gate",
	"news.rss", "news.square", "announcements.binance", "announcements.bybit", "announcements.okx",
	"announcements.bithumb", "global", "fearGreed", "stablecoins", "premium.coinbase", "premium.korea", "options", "dvol",
	"altseason"}

// Status is when a kind last arrived and its last failure.
type Status struct {
	Updated *string `json:"updated"`
	Error   *string `json:"error"`
}

// Sources is every kind's status, written in the order of `kinds`.
type Sources map[string]Status

// MarshalJSON keeps the kinds' order.
func (s Sources) MarshalJSON() ([]byte, error) {
	var out bytes.Buffer
	out.WriteByte('{')
	for i, kind := range kinds {
		if i > 0 {
			out.WriteByte(',')
		}
		status, err := json.Marshal(s[kind])
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(&out, "%q:%s", kind, status)
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}

// Coin is one quoted contract as the page draws it. OIByVenue is the open interest in USD on each exchange
// that has some, the largest first; Liquidations those of the last 24 hours in USD, the exchanges' together
// (see Snapshot.LiquidationsSince).
type Coin struct {
	Symbol       string   `json:"symbol"`
	Base         string   `json:"base"`
	Name         string   `json:"name"`
	Sector       string   `json:"sector"`
	Subsector    *string  `json:"subsector"`
	Price        float64  `json:"price"`
	Change24h    float64  `json:"change24h"`
	Volume24h    float64  `json:"volume24h"`
	Funding      *float64 `json:"funding"`
	MarketCap    *float64 `json:"marketCap"`
	FDV          *float64 `json:"fdv"`
	Change1h     *float64 `json:"change1h"`
	Change4h     *float64 `json:"change4h"`
	Change7d     *float64 `json:"change7d"`
	OI           *float64 `json:"oi"`
	OIChange24h  *float64 `json:"oiChange24h"`
	LongShort    *float64 `json:"longShort"`
	OIByVenue    [][2]any `json:"oiByVenue"`
	Liquidations Sides    `json:"liquidations"`
}

// Snapshot is every coin. LiquidationsSince is when the overview began recording the liquidations Binance,
// Bybit and OKX push, all three; nil until all three have connected. Global is the whole market's readings
// beyond these coins.
type Snapshot struct {
	Sectors           []string `json:"sectors"`
	Coins             []Coin   `json:"coins"`
	LiquidationsSince *string  `json:"liquidationsSince"`
	Global            Global   `json:"global"`
	Sources           Sources  `json:"sources"`
}

// VenueRow is a coin on one exchange. Liquidations are the last 24 hours' on an exchange the overview
// records, else nil.
type VenueRow struct {
	Venue         string   `json:"venue"`
	OI            *float64 `json:"oi"`
	Funding       *float64 `json:"funding"`
	IntervalHours *float64 `json:"intervalHours"`
	Liquidations  *Sides   `json:"liquidations"`
}

// CoinDetail is a contract's seven-day line and its coin on each exchange.
type CoinDetail struct {
	Symbol string     `json:"symbol"`
	Line   Line       `json:"line"`
	Venues []VenueRow `json:"venues"`
}

// NewsItem is a headline with the contracts of the coins it names.
type NewsItem struct {
	Source  string   `json:"source"`
	Kind    string   `json:"kind"`
	Title   string   `json:"title"`
	Link    string   `json:"link"`
	At      float64  `json:"at"`
	Symbols []string `json:"symbols"`
}

const (
	// namedCoins is how many of the largest coins a headline may name by name rather than by code.
	namedCoins = 30
	// defaultIntervalHours is Binance's usual funding period, for contracts `fundingInfo` leaves out.
	defaultIntervalHours = 8
	headlineLimit        = 1000
)

// Store holds every kind of data; its lock guards all of it, the two records included. An answer is built
// under the lock and holds nothing that is changed in place afterwards, so it is written after the lock.
type Store struct {
	mu               sync.Mutex
	contracts        []Contract
	quotes           map[string]Quote
	funding          map[string]float64
	intervals        map[string]float64
	interest         map[string]Interest
	moves            map[string]Moves
	lines            map[string]Line
	ratios           map[string]float64
	ids              map[string]string
	caps             map[string]Cap
	categories       map[string]map[string]bool
	venues           map[string]map[string]Market
	liquidations     *Liquidations
	gateLiquidations map[string]Sides // each coin's long and short liquidations on Gate over the last day
	headlines        *Headlines
	global           Global
	status           map[string]Status
	clock            func() time.Time
}

func newStore() *Store {
	status := make(map[string]Status, len(kinds))
	for _, kind := range kinds {
		status[kind] = Status{}
	}
	return &Store{
		quotes: map[string]Quote{}, funding: map[string]float64{}, intervals: map[string]float64{}, interest: map[string]Interest{},
		moves: map[string]Moves{}, lines: map[string]Line{}, ratios: map[string]float64{}, ids: map[string]string{}, caps: map[string]Cap{},
		categories: map[string]map[string]bool{}, venues: map[string]map[string]Market{}, liquidations: newLiquidations(wallClock),
		gateLiquidations: map[string]Sides{}, headlines: newHeadlines(wallClock, headlineLimit), status: status, clock: time.Now,
	}
}

func isoTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// update changes the store under its lock.
func (s *Store) update(change func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	change()
}

// arrived marks a kind updated now.
func (s *Store) arrived(kind string) {
	now := isoTime(s.clock())
	s.status[kind] = Status{Updated: &now}
}

// failed records a kind's failure while its old value stays.
func (s *Store) failed(kind, message string) {
	status := s.status[kind]
	status.Error = &message
	s.status[kind] = status
}

// refresh records a kind's new value, or its failure while the old value stays. A shape no reader foresaw
// fails its kind like any other.
func (s *Store) refresh(kind string, read func() error) {
	err := func() (err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("%v", r)
			}
		}()
		return read()
	}()
	s.update(func() {
		if err != nil {
			s.failed(kind, err.Error())
		} else {
			s.arrived(kind)
		}
	})
}

// succeeded answers whether a kind's last refresh left no failure.
func (s *Store) succeeded(kind string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status[kind].Error == nil
}

func present[K comparable](m map[K]float64, key K) *float64 {
	if v, ok := m[key]; ok {
		return &v
	}
	return nil
}

// snapshot is the coins with a quote, in the contract list's order.
func (s *Store) snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	quoted := make([]placing, 0, len(s.contracts))
	for _, c := range s.contracts {
		if _, ok := s.quotes[c.Symbol]; ok {
			quoted = append(quoted, placing{c.Symbol, c.Sector, s.ids[c.Symbol]})
		}
	}
	places := place(quoted, s.categories)
	recorded := s.liquidations.byCoin()
	coins := make([]Coin, 0, len(quoted))
	for _, c := range s.contracts {
		quote, ok := s.quotes[c.Symbol]
		if !ok {
			continue
		}
		cap, hasCap := s.caps[s.ids[c.Symbol]]
		name := c.Base
		if hasCap {
			name = cap.Name
		}
		moves, oi := s.moves[c.Symbol], s.interest[c.Symbol]
		_, hasOI := s.interest[c.Symbol]
		rows := s.venueRows(c, recorded)
		held := make([][2]any, 0, len(rows))
		var liquidations Sides
		byOI := make([]VenueRow, 0, len(rows))
		for _, v := range rows {
			if truthy(v.OI) {
				byOI = append(byOI, v)
			}
			if v.Liquidations != nil {
				liquidations.Long += v.Liquidations.Long
				liquidations.Short += v.Liquidations.Short
			}
		}
		sort.SliceStable(byOI, func(a, b int) bool { return *byOI[a].OI > *byOI[b].OI })
		for _, v := range byOI {
			held = append(held, [2]any{v.Venue, *v.OI})
		}
		where := places[c.Symbol]
		coin := Coin{Symbol: c.Symbol, Base: c.Base, Name: name, Sector: where.Sector, Subsector: where.Subsector,
			Price: quote.Price, Change24h: quote.Change24h, Volume24h: quote.Volume24h,
			Funding: present(s.funding, c.Symbol), MarketCap: cap.MarketCap, FDV: cap.FDV,
			Change1h: change(quote.Price, moves.Back1h), Change4h: change(quote.Price, moves.Back4h), Change7d: change(quote.Price, moves.Back7d),
			LongShort: present(s.ratios, c.Symbol), OIByVenue: held, Liquidations: liquidations}
		if hasOI {
			coin.OI, coin.OIChange24h = &oi.OI, oi.OIChange24h
		}
		coins = append(coins, coin)
	}
	sources := make(Sources, len(s.status))
	for kind, status := range s.status {
		sources[kind] = status
	}
	return Snapshot{Sectors: sectors, Coins: coins, LiquidationsSince: s.allRecordingSince(), Global: s.global, Sources: sources}
}

func (s *Store) allRecordingSince() *string {
	latest := 0.0
	for _, venue := range liquidationVenues {
		since, ok := s.liquidations.since[venue]
		if !ok {
			return nil
		}
		latest = max(latest, since)
	}
	at := isoTime(time.UnixMilli(int64(latest)))
	return &at
}

// coin is a contract's seven-day line and its open interest and funding on each exchange listing its coin,
// Binance first; nil for a contract not in the list.
func (s *Store) coin(symbol string) *CoinDetail {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.contracts {
		if c.Symbol == symbol {
			line := s.lines[symbol]
			if line == nil {
				line = Line{}
			}
			return &CoinDetail{symbol, line, s.venueRows(c, s.liquidations.byCoin())}
		}
	}
	return nil
}

// news is the last week's headlines, the newest first, each with the contracts of the coins it names: by
// code, or for the largest coins by market cap also by name. A headline whose source names coins but none
// with a contract here (a stock token, a coin only Korea lists) is left out, as are the exchanges'
// announcements of TradFi contracts.
func (s *Store) news() []NewsItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	symbols := make(map[string]string, len(s.contracts))
	listed := make(map[string]bool, len(s.contracts))
	type sized struct {
		contract Contract
		cap      Cap
	}
	var largest []sized
	for _, c := range s.contracts {
		key := coinKey(c.Base)
		symbols[key], listed[key] = c.Symbol, true
		if id, ok := s.ids[c.Symbol]; ok {
			if cap, ok := s.caps[id]; ok && truthy(cap.MarketCap) {
				largest = append(largest, sized{c, cap})
			}
		}
	}
	sort.SliceStable(largest, func(a, b int) bool { return *largest[a].cap.MarketCap > *largest[b].cap.MarketCap })
	var names []coinName
	nameAt := map[string]int{}
	for _, l := range largest[:min(len(largest), namedCoins)] {
		if length(l.cap.Name) < 3 || l.cap.Name == l.contract.Base {
			continue
		}
		key := coinKey(l.contract.Base)
		if at, ok := nameAt[l.cap.Name]; ok {
			names[at].Coin = key
			continue
		}
		nameAt[l.cap.Name] = len(names)
		names = append(names, coinName{l.cap.Name, key})
	}
	headlines := s.headlines.list()
	out := make([]NewsItem, 0, len(headlines))
	for _, h := range headlines {
		named := len(h.Coins) == 0
		for _, c := range h.Coins {
			named = named || listed[c]
		}
		if tradFi(h) || !named {
			continue
		}
		found := mentions(h, listed, names)
		item := NewsItem{h.Source, h.Kind, h.Title, h.Link, h.At, make([]string, 0, len(found))}
		for _, key := range found {
			item.Symbols = append(item.Symbols, symbols[key])
		}
		out = append(out, item)
	}
	return out
}

// venueRows is a contract's market on Binance, then its coin's on each other exchange listing it, with the
// liquidations `recorded` there (none yet once recording began) or Gate's from its stats.
func (s *Store) venueRows(c Contract, recorded map[string]map[string]*Sides) []VenueRow {
	coin := coinKey(c.Base)
	liquidations := func(venue string) *Sides {
		switch venue {
		case "Gate":
			if sides, ok := s.gateLiquidations[coin]; ok {
				return &sides
			}
			return nil
		case "Binance", "Bybit", "OKX":
			if sides := recorded[coin][venue]; sides != nil {
				return sides
			}
			if _, began := s.liquidations.since[venue]; began {
				return &Sides{}
			}
		}
		return nil
	}
	first := VenueRow{Venue: "Binance", Funding: present(s.funding, c.Symbol), Liquidations: liquidations("Binance")}
	if oi, ok := s.interest[c.Symbol]; ok {
		first.OI = &oi.OI
	}
	first.IntervalHours = present(s.intervals, c.Symbol)
	if first.IntervalHours == nil {
		first.IntervalHours = of(defaultIntervalHours)
	}
	out := append(make([]VenueRow, 0, len(venues)+1), first)
	for _, venue := range venues {
		if m, ok := s.venues[venue][coin]; ok {
			out = append(out, VenueRow{venue, m.OI, m.Funding, m.IntervalHours, liquidations(venue)})
		}
	}
	return out
}
