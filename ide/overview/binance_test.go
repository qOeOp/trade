package main

import (
	"fmt"
	"testing"
)

func TestBinanceQuotesAndFundingAreReadPerSymbolAsNumbers(t *testing.T) {
	q := must[map[string]Quote](t)(quotes(fixture(t, "ticker24hr.json")))["BTCUSDT"]
	if q.Price <= 1000 || q.Change24h >= 50 || q.Change24h <= -50 || q.Volume24h <= 1e8 {
		t.Errorf("%+v", q)
	}
	f := must[map[string]float64](t)(fundingRates(fixture(t, "premiumIndex.json")))["BTCUSDT"]
	if f >= 0.01 || f <= -0.01 {
		t.Errorf("%v", f)
	}
	empty := must[map[string]Quote](t)(quotes([]any{obj{"symbol": "X", "lastPrice": "", "priceChangePercent": "1", "quoteVolume": "2"}}))
	wantEqual(t, len(empty), 0)
	if _, err := quotes(obj{"code": -1.0}); err == nil {
		t.Error("a body that is no list fails the kind, so its last value stays")
	}
}

func TestOpenInterestIsTheLastFiveMinutesItsChangeOver24Hours(t *testing.T) {
	body := list(t, fixture(t, "openInterestHist.json"))
	last, first := body[len(body)-1].(obj)["sumOpenInterestValue"], body[0].(obj)["sumOpenInterestValue"]
	read := must[*Interest](t)(interest(body))
	wantEqual(t, read.OI, number(t, last))
	wantNear(t, read.OIChange24h, (number(t, last)/number(t, first)-1)*100)
	wantNil(t, must[*Interest](t)(interest(body[1:])).OIChange24h) // twelve hours of history is no 24h change
	if must[*Interest](t)(interest([]any{})) != nil {
		t.Error("no rows, no reading")
	}
}

func TestTheWindowsStartFromTheClose12And48FiveMinuteKlinesAnd168HourlyOnesBack(t *testing.T) {
	hourly := list(t, fixture(t, "klines1h.json"))
	five := make([]any, 49)
	for i := range five {
		five[i] = []any{float64(i * 300_000), "0", "0", "0", fmt.Sprint(100 + i)}
	}
	read, line, err := moves(five, hourly)
	if err != nil {
		t.Fatal(err)
	}
	wantNumber(t, read.Back1h, 136)
	wantNumber(t, read.Back4h, 100)
	wantNumber(t, read.Back7d, number(t, hourly[0].([]any)[4]))
	wantEqual(t, len(line), 169)
	wantEqual(t, line[0], [2]float64{number(t, hourly[0].([]any)[0]) / 1000, number(t, hourly[0].([]any)[4])})
	short, _, err := moves(five[:20], hourly[:100])
	if err != nil {
		t.Fatal(err)
	}
	wantNil(t, short.Back4h)
	wantNear(t, change(110, of(100)), 10)
	wantNil(t, change(110, nil))
	wantNil(t, change(110, of(0)))
}

func TestTheLongShortRatioAndOtherFundingPeriods(t *testing.T) {
	wantNumber(t, must[*float64](t)(longShort(fixture(t, "longShortRatio.json"))), 2.2573)
	wantEqual(t, must[map[string]float64](t)(fundingIntervals(fixture(t, "fundingInfo.json")))["GTCUSDT"], 4.0)
}

func TestACoinDropsTheSizeWrittenIntoItsSymbol(t *testing.T) {
	for base, want := range map[string]string{"1000PEPE": "PEPE", "SHIB1000": "SHIB", "1MBABYDOGE": "BABYDOGE", "1000000MOG": "MOG", "10000SATS": "SATS", "1INCH": "1INCH", "BTC": "BTC"} {
		wantEqual(t, coinKey(base), want)
	}
}

func TestEachExchangesOpenInterestInUSDWithFundingAndPeriodKeyedByCoin(t *testing.T) {
	keys := func(m map[string]Market) map[string]bool {
		out := map[string]bool{}
		for k := range m {
			out[k] = true
		}
		return out
	}
	bybitRows := field(fixture(t, "bybitTickers.json"), "result", "list").([]any)
	by, btcRow := bybitMarkets(bybitRows), find(t, bybitRows, "symbol", "BTCUSDT")
	wantEqual(t, keys(by), map[string]bool{"BTC": true, "PEPE": true, "SHIB": true}) // USDC (…PERP) and dated contracts left out
	wantNumber(t, by["BTC"].OI, number(t, btcRow["openInterestValue"]))
	wantNumber(t, by["BTC"].Funding, number(t, btcRow["fundingRate"]))
	wantNumber(t, by["BTC"].IntervalHours, 8)

	okxOI, okxRates := field(fixture(t, "okxOpenInterest.json"), "data").([]any), field(fixture(t, "okxFunding.json"), "data").([]any)
	o := okxMarkets(okxOI, okxRates)
	wantEqual(t, keys(o), map[string]bool{"BTC": true, "PEPE": true}) // the coin-margined BTC-USD-SWAP left out
	wantNumber(t, o["BTC"].OI, number(t, find(t, okxOI, "instId", "BTC-USDT-SWAP")["oiUsd"]))
	if h := *o["BTC"].IntervalHours; h != 1 && h != 2 && h != 4 && h != 8 {
		t.Errorf("OKX's period: %v", h)
	}

	bgRows, bgContracts := field(fixture(t, "bitgetTickers.json"), "data").([]any), field(fixture(t, "bitgetContracts.json"), "data").([]any)
	bg, bgRow := bitgetMarkets(bgRows, bgContracts), find(t, bgRows, "symbol", "BTCUSDT")
	wantNear(t, bg["BTC"].OI, number(t, bgRow["holdingAmount"])*number(t, bgRow["markPrice"]))
	wantNumber(t, bg["BTC"].IntervalHours, 8)
	wantNil(t, bitgetMarkets(bgRows, nil)["BTC"].IntervalHours)

	gateRows := list(t, fixture(t, "gateTickers.json"))
	g, gRow := gateMarkets(gateRows, list(t, fixture(t, "gateContracts.json"))), find(t, gateRows, "contract", "BTC_USDT")
	wantNear(t, g["BTC"].OI, number(t, gRow["total_size"])*number(t, gRow["quanto_multiplier"])*number(t, gRow["mark_price"]))
	wantNumber(t, g["BTC"].IntervalHours, 8)

	h := hyperliquidMarkets(fixture(t, "hyperliquidMetaAndAssetCtxs.json"))
	wantNear(t, h["BTC"].OI, 40226.62362*78376)
	wantNumber(t, h["BTC"].Funding, 0.0000125)
	wantNumber(t, h["BTC"].IntervalHours, 1)
	wantNear(t, h["PEPE"].OI, 11808541390*0.004919)
	wantEqual(t, keys(h), map[string]bool{"BTC": true, "ETH": true, "PEPE": true})
	wantEqual(t, len(hyperliquidMarkets(obj{"error": "bad"})), 0)

	for _, m := range []map[string]Market{by, o, bg, g, h} {
		if *m["BTC"].OI <= 1e8 || *m["BTC"].Funding >= 0.01 || *m["BTC"].Funding <= -0.01 {
			t.Errorf("%+v", m["BTC"])
		}
	}
}

func TestOfTwoContractsOnOneCoinTheOneWithMoreOpenInterestStandsForIt(t *testing.T) {
	small := obj{"symbol": "PEPEUSDT", "openInterestValue": "5", "fundingRate": "0.001", "fundingIntervalHour": "4"}
	large := obj{"symbol": "1000PEPEUSDT", "openInterestValue": "900", "fundingRate": "0.0001", "fundingIntervalHour": "8"}
	for _, order := range [][]any{{small, large}, {large, small}} {
		got := bybitMarkets(order)["PEPE"]
		wantNumber(t, got.OI, 900)
		wantNumber(t, got.Funding, 0.0001)
		wantNumber(t, got.IntervalHours, 8)
	}
}

func TestCoinGeckosWrongMappingsAreFixedAndContractsWithoutACoinSkipped(t *testing.T) {
	ids := must[map[string]string](t)(coinIDs(fixture(t, "binanceFutures.json")))
	wantEqual(t, ids["BTCUSDT"], "bitcoin")
	wantEqual(t, ids["1000SHIBUSDT"], "shiba-inu")
	if _, ok := ids["XAUUSDT"]; ok {
		t.Error("XAUUSDT has no coin")
	}
}

func TestMarketCapsPerCoinIDAndIDsGoOutInPagesOfAtMost250(t *testing.T) {
	found := must[map[string]Cap](t)(caps(fixture(t, "coinsMarkets.json")))
	wantEqual(t, found["bitcoin"].Name, "Bitcoin")
	if *found["bitcoin"].MarketCap <= 1e11 {
		t.Error(*found["bitcoin"].MarketCap)
	}
	many := []string{"coin-0"}
	for i := range 2*geckoPage + 3 {
		many = append(many, fmt.Sprintf("coin-%d", i))
	}
	var sizes []int
	for _, p := range pages(many) {
		sizes = append(sizes, len(p))
	}
	wantEqual(t, sizes, []int{geckoPage, geckoPage, 3})
}

func TestOnlyTradingUSDTPerpetualsOnACoinAreDrawnEachInOneSector(t *testing.T) {
	found := must[[]Contract](t)(contracts(fixture(t, "exchangeInfo.json")))
	sector := map[string]string{}
	for _, c := range found {
		sector[c.Symbol] = c.Sector
	}
	wantEqual(t, sector, map[string]string{"BTCUSDT": "PoW", "ETHUSDT": "Layer 1", "1000SHIBUSDT": "Meme", "SANTOSUSDT": "Other"})
	wantEqual(t, sectorOf([]any{"Crypto", "Storage"}), "Infrastructure")
	wantEqual(t, sectorOf([]any{"Alpha", "Chinese"}), "Meme")
	wantEqual(t, sectorOf([]any{"Crypto", "SomethingNew"}), "Other")
	wantEqual(t, sectorOf(nil), "Other")
}

func sectorCoins(sector string, n int, prefix string) []placing {
	out := make([]placing, n)
	for i := range out {
		out[i] = placing{fmt.Sprintf("%s%dUSDT", prefix, i), sector, fmt.Sprintf("%s-%d", prefix, i)}
	}
	return out
}

func sub(p *Place) string {
	if p.Subsector == nil {
		return ""
	}
	return *p.Subsector
}

func TestALargeSectorSplitsByTheFirstMatchingCategoryALoneSubSectorFolds(t *testing.T) {
	defi := sectorCoins("DeFi", 30, "defi")
	held := map[string]map[string]bool{}
	for _, c := range defi[:10] {
		held[c.ID] = map[string]bool{"decentralized-perpetuals": true, "decentralized-exchange": true} // Perpetuals comes first
	}
	for _, c := range defi[10:20] {
		held[c.ID] = map[string]bool{"decentralized-exchange": true}
	}
	held[defi[20].ID] = map[string]bool{"lending-borrowing": true}
	placed := place(defi, held)
	for i, want := range map[int]string{0: "Perpetuals", 10: "DEX", 20: "Other DeFi", 29: "Other DeFi"} {
		wantEqual(t, sub(placed[defi[i].Symbol]), want)
	}
}

func TestAnUntaggedCoinJoinsTheFirstTableSectorHoldingItSmallOrUnknownSectorsDoNotSplit(t *testing.T) {
	other, meme, l1 := sectorCoins("Other", 26, "other"), sectorCoins("Meme", 3, "meme"), sectorCoins("Layer 1", 40, "l1")
	held := map[string]map[string]bool{other[0].ID: {"dog-themed-coins": true}, other[1].ID: {"prediction-markets": true}, other[2].ID: {"prediction-markets": true}}
	placed := place(append(append(other[:26:26], meme...), l1...), held)
	wantEqual(t, placed[other[0].Symbol].Sector, "Meme")
	wantEqual(t, sub(placed[other[0].Symbol]), "") // four Meme coins are too few to split
	wantEqual(t, placed[other[1].Symbol].Sector, "Other")
	wantEqual(t, sub(placed[other[1].Symbol]), "Prediction markets")
	wantEqual(t, sub(placed[other[3].Symbol]), "Unsorted")
	wantEqual(t, sub(placed[l1[0].Symbol]), "") // no table for Layer 1
}

func TestBeforeTheMembershipsArriveNoSectorSplitsAndCategoriesAreListedOnce(t *testing.T) {
	for _, p := range place(sectorCoins("DeFi", 40, "defi"), nil) {
		wantEqual(t, p.Sector, "DeFi")
		wantEqual(t, sub(p), "")
	}
	seen := map[string]bool{}
	for _, c := range categories {
		if seen[c] {
			t.Errorf("twice: %s", c)
		}
		seen[c] = true
	}
	wantEqual(t, len(categories), 46)
}
