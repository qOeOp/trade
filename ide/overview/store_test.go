package main

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func filled() *Store {
	s := newStore()
	s.contracts = []Contract{{"BTCUSDT", "BTC", "PoW"}, {"NEWUSDT", "NEW", "Other"}, {"OLDUSDT", "OLD", "Other"}}
	s.quotes = map[string]Quote{"BTCUSDT": {77930, 0.34, 3.7e9}, "NEWUSDT": {1, -2, 1e6}}
	s.funding = map[string]float64{"BTCUSDT": 0.0001}
	s.ids = map[string]string{"BTCUSDT": "bitcoin"}
	s.caps = map[string]Cap{"bitcoin": {"Bitcoin", of(1.57e12), of(1.6e12)}}
	s.moves = map[string]Moves{"BTCUSDT": {of(62344), nil, of(77930 * 2)}} // the windows measured against the latest price
	s.lines = map[string]Line{"BTCUSDT": {{1793000000, 76000}, {1793003600, 77000}}}
	s.interest = map[string]Interest{"BTCUSDT": {8e9, of(2.5)}}
	s.ratios = map[string]float64{"BTCUSDT": 1.8}
	s.intervals = map[string]float64{"NEWUSDT": 4}
	s.venues["Bybit"] = map[string]Market{"BTC": {of(5e9), of(0.00005), of(8)}}
	s.venues["OKX"] = map[string]Market{"NEW": {of(1e6), nil, of(4)}}
	return s
}

func TestTheSnapshotJoinsEachQuotedContractWithItsFundingAndMarketCap(t *testing.T) {
	coins := filled().snapshot().Coins
	wantEqual(t, len(coins), 2) // no quote, no tile
	wantJSON(t, coins[0], `{"symbol":"BTCUSDT","base":"BTC","name":"Bitcoin","sector":"PoW","subsector":null,"price":77930,"change24h":0.34,"volume24h":3700000000,"funding":0.0001,"marketCap":1570000000000,"fdv":1600000000000,"change1h":25,"change4h":null,"change7d":-50,"oi":8000000000,"oiChange24h":2.5,"longShort":1.8,"oiByVenue":[["Binance",8000000000],["Bybit",5000000000]],"liquidations":{"long":0,"short":0}}`)
	wantJSON(t, coins[1], `{"symbol":"NEWUSDT","base":"NEW","name":"NEW","sector":"Other","subsector":null,"price":1,"change24h":-2,"volume24h":1000000,"funding":null,"marketCap":null,"fdv":null,"change1h":null,"change4h":null,"change7d":null,"oi":null,"oiChange24h":null,"longShort":null,"oiByVenue":[["OKX",1000000]],"liquidations":{"long":0,"short":0}}`) // only exchanges with open interest
}

func TestAKindThatFailsKeepsItsLastValueAndSaysWhyTheOthersUnaffected(t *testing.T) {
	s := filled()
	s.clock = func() time.Time { return time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC) }
	s.refresh("quotes", func() error { return nil })
	s.refresh("quotes", func() error { return errors.New("fapi answered 503") })
	wantJSON(t, s.snapshot().Sources["quotes"], `{"updated":"2026-11-02T10:00:00.000Z","error":"fapi answered 503"}`)
	wantEqual(t, len(s.snapshot().Coins), 2)
	wantJSON(t, s.snapshot().Sources["caps"], `{"updated":null,"error":null}`)
	s.refresh("caps", func() error { panic("a shape no reader foresaw") })
	wantEqual(t, *s.snapshot().Sources["caps"].Error, "a shape no reader foresaw")
}

func TestSourcesAreWrittenInTheKindsOrderEveryKindPresent(t *testing.T) {
	body, err := json.Marshal(filled().snapshot().Sources)
	if err != nil {
		t.Fatal(err)
	}
	var read map[string]Status
	if err := json.Unmarshal(body, &read); err != nil {
		t.Fatal(err)
	}
	wantEqual(t, len(read), 32)
	wantEqual(t, string(body[:len(`{"contracts":`)]), `{"contracts":`)
}

func TestLiquidationsEachExchangesRecordedOrHourlySummedAndSinceWhenAllThreeRecord(t *testing.T) {
	s := filled()
	s.venues["Gate"] = map[string]Market{"BTC": {of(4e9), of(0.0001), of(8)}}
	s.liquidations = newLiquidations(func() int64 { return 1793602534217 })
	s.liquidations.started("Bybit")
	s.liquidations.add([]Liquidation{{"Bybit", "BTCUSDT", "BTC", true, 3000, 1793602534217, "k"}})
	s.gateLiquidations["BTC"] = Sides{500, 20}
	if s.snapshot().LiquidationsSince != nil { // Binance and OKX not yet connected
		t.Error("not all three record yet")
	}
	wantEqual(t, s.snapshot().Coins[0].Liquidations, Sides{3500, 20})
	wantJSON(t, s.coin("BTCUSDT").Venues, `[{"venue":"Binance","oi":8000000000,"funding":0.0001,"intervalHours":8,"liquidations":null},{"venue":"Bybit","oi":5000000000,"funding":0.00005,"intervalHours":8,"liquidations":{"long":3000,"short":0}},{"venue":"Gate","oi":4000000000,"funding":0.0001,"intervalHours":8,"liquidations":{"long":500,"short":20}}]`)
	s.liquidations.started("Binance")
	s.liquidations.started("OKX")
	wantEqual(t, *s.snapshot().LiquidationsSince, isoTime(time.UnixMilli(1793602534217)))
}

func TestACoinsDetailsItsSevenDayLineAndEachExchangeListingItsCoinBinanceFirst(t *testing.T) {
	s := filled()
	wantJSON(t, s.coin("BTCUSDT"), `{"symbol":"BTCUSDT","line":[[1793000000,76000],[1793003600,77000]],"venues":[{"venue":"Binance","oi":8000000000,"funding":0.0001,"intervalHours":8,"liquidations":null},{"venue":"Bybit","oi":5000000000,"funding":0.00005,"intervalHours":8,"liquidations":null}]}`)
	venues := s.coin("NEWUSDT").Venues
	wantEqual(t, []any{venues[0].Venue, *venues[0].IntervalHours, venues[1].Venue, *venues[1].IntervalHours}, []any{"Binance", 4.0, "OKX", 4.0})
	wantJSON(t, s.coin("OLDUSDT").Line, `[]`)
	if s.coin("NOPEUSDT") != nil {
		t.Error("no such contract")
	}
}

func TestNewsEachHeadlineWithTheContractsItNamesNoneOnlyUnlistedNorTradFi(t *testing.T) {
	s := newStore()
	s.contracts = []Contract{{"BTCUSDT", "BTC", "PoW"}, {"1000PEPEUSDT", "1000PEPE", "Meme"}}
	s.ids = map[string]string{"BTCUSDT": "bitcoin", "1000PEPEUSDT": "pepe"}
	s.caps = map[string]Cap{"bitcoin": {"Bitcoin", of(1.57e12), nil}, "pepe": {"Pepe", of(1e9), nil}}
	at := float64(time.Now().UnixMilli())
	s.headlines.add([]Headline{
		{"X", "news", "Bitcoin and PEPE rally", "https://x.test/1", at, nil},
		{"Upbit", "announcement", "닐리온(NIL) 추가", "https://x.test/2", at - 1, []string{"NIL"}},
		{"Binance Square", "news", "Tesla FSD praised", "https://x.test/3", at - 2, []string{"TSLAB"}},
		{"Bithumb", "announcement", "비트코인(BTC) 안내", "https://x.test/4", at - 3, []string{"BTC"}},
		{"Bybit", "announcement", "New listing: Listing of XLIUSDT on Bybit TradFi Perpetual", "https://x.test/5", at - 4, nil},
	})
	wantEqual(t, s.news(), []NewsItem{
		{"X", "news", "Bitcoin and PEPE rally", "https://x.test/1", at, []string{"1000PEPEUSDT", "BTCUSDT"}},
		{"Bithumb", "announcement", "비트코인(BTC) 안내", "https://x.test/4", at - 3, []string{"BTCUSDT"}},
	})
}
