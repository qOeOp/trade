package main

import "testing"

func TestCoinGeckosTotalsAndAlternativeMesIndex(t *testing.T) {
	body := fixture(t, "coingeckoGlobal.json")
	var read Global
	marketCap(body, &read)
	wantNumber(t, read.MarketCap, field(body, "data", "total_market_cap", "usd").(float64))
	wantNumber(t, read.MarketCapChange24h, field(body, "data", "market_cap_change_percentage_24h_usd").(float64))
	wantNumber(t, read.BTCShare, field(body, "data", "market_cap_percentage", "btc").(float64))
	var none Global
	marketCap(obj{}, &none)
	wantNil(t, none.MarketCap)
	wantEqual(t, *fearGreed(fixture(t, "fearGreed.json")), FearGreed{37, "Fear"})
	if fearGreed(obj{"data": []any{}}) != nil {
		t.Error("no data, no index")
	}
}

func TestStablecoinsUSDPeggedOnesTheWeeksChangeAmongThoseReportingLastWeek(t *testing.T) {
	body := fixture(t, "stablecoins.json")
	var supply, now, before float64
	reporting, usd := 0, 0
	each(field(body, "peggedAssets").([]any), func(a obj) {
		if a["pegType"] != "peggedUSD" {
			return
		}
		usd++
		c := field(a["circulating"], "peggedUSD").(float64)
		supply += c
		if w, ok := field(a["circulatingPrevWeek"], "peggedUSD").(float64); ok && w != 0 { // USDL's is {}
			reporting++
			now += c
			before += w
		}
	})
	wantEqual(t, usd-reporting, 1) // the fixture holds one coin without last week's figure
	read := must[*Stablecoins](t)(stablecoins(body))
	wantNear(t, &read.Supply, supply) // the euro coin is left out
	wantNear(t, read.Change7d, (now/before-1)*100)
	if must[*Stablecoins](t)(stablecoins(obj{"peggedAssets": []any{}})) != nil {
		t.Error("no coins, no reading")
	}
}

func TestPremiumsCoinbasesInDollarsAtKrakensTetherRateUpbitsInTether(t *testing.T) {
	spot, krakenBody, upbitBody := fixture(t, "binanceSpotPrice.json"), fixture(t, "krakenUsdtUsd.json"), list(t, fixture(t, "upbitTicker.json"))
	usd, binancePrice := number(t, field(fixture(t, "coinbaseTicker.json"), "price")), number(t, field(spot, "price"))
	tether := number(t, item(field(krakenBody, "result", "USDTZUSD", "c"), 0))
	wantNear(t, coinbasePremium(fixture(t, "coinbaseTicker.json"), spot, krakenBody), (usd/(binancePrice*tether)-1)*100)
	krw := func(m string) float64 { return find(t, upbitBody, "market", m)["trade_price"].(float64) }
	wantNear(t, must[*float64](t)(koreaPremium(upbitBody, spot)), (krw("KRW-BTC")/krw("KRW-USDT")/binancePrice-1)*100)
	wantNil(t, must[*float64](t)(koreaPremium(upbitBody[:1], spot))) // no Tether price, no premium
	wantNil(t, coinbasePremium(obj{}, spot, krakenBody))
}

func TestMaxPainTheStrikeThatPaysCallsBelowItAndPutsAboveItLeast(t *testing.T) {
	o := func(strike float64, put bool, oi float64) option { return option{"2026-11-06", strike, put, oi} }
	// At 100: puts at 110 pay 10 × 5 = 50. At 110: calls at 100 pay 10 × 1 = 10. At 120: calls 20 × 1 + 10 × 2 = 40, puts nothing.
	wantNumber(t, maxPainStrike([]option{o(100, false, 1), o(110, false, 2), o(110, true, 5), o(120, true, 0)}), 110)
	wantNil(t, maxPainStrike(nil))
}

func TestDeribitOptionsAllExpiriesAtTheIndexTheNearestFridaysMaxPainAndDVOL(t *testing.T) {
	body := fixture(t, "deribitOptions.json")
	read := must[*Options](t)(bitcoinOptions(body))
	result := field(body, "result").([]any)
	var total, calls, puts float64
	var listed bool
	each(result, func(r obj) {
		oi, name := r["open_interest"].(float64), r["instrument_name"].(string)
		total += oi
		if name[len(name)-2:] == "-P" {
			puts += oi
		} else {
			calls += oi
		}
	})
	wantNear(t, &read.OI, total*field(result[0], "estimated_delivery_price").(float64))
	wantNear(t, read.PutCall, puts/calls)
	wantEqual(t, read.MaxPain.Expiry, "2026-11-06") // Friday the 6th, not Tuesday the 3rd
	each(result, func(r obj) {
		listed = listed || r["instrument_name"] == "BTC-6NOV26-"+plainNumber(read.MaxPain.Strike)+"-C"
	})
	wantEqual(t, listed, true)
	if must[*Options](t)(bitcoinOptions(obj{"result": []any{}})) != nil {
		t.Error("no rows, no reading")
	}
	d := fixture(t, "deribitDvol.json")
	wantNumber(t, dvol(d), item(item(field(d, "result", "data"), -1), 4).(float64))
	wantEqual(t, expiryDate("6NOV26"), "2026-11-06")
	wantEqual(t, expiryDate("6XXX26"), "")
}

func TestAltcoinSeasonTheShareOfCoinsWith90DaysOfHistoryThatRoseMoreThanBitcoin(t *testing.T) {
	klines := list(t, fixture(t, "klines1d.json"))
	wantEqual(t, len(klines), seasonDays+1)
	wantNear(t, must[*float64](t)(seasonChange(klines)), number(t, item(klines[len(klines)-1], 4))/number(t, item(klines[0], 4))-1)
	wantNil(t, must[*float64](t)(seasonChange(klines[1:]))) // a coin listed within the window is not counted
	wantEqual(t, *altseason(of(0.1), []*float64{of(0.2), of(0.05), nil, of(0.3)}), Altseason{67, 3})
	if altseason(nil, []*float64{of(0.2)}) != nil {
		t.Error("no Bitcoin, no index")
	}
}
