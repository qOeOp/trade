package main

import "testing"

const hourMilli = 3_600_000.0

func TestBybitABuyIsALongLiquidatedWorthItsCoinsTimesItsPrice(t *testing.T) {
	both := list(t, fixture(t, "bybitAllLiquidation.json"))
	near0, btc := both[0], both[1].(obj)
	read := fromBybit(btc)
	wantEqual(t, len(read), 1)
	wantNear(t, &read[0].USD, 0.048*77864.7)
	read[0].USD = 0
	wantEqual(t, read[0], Liquidation{"Bybit", "BTCUSDT", "BTC", true, 0, 1793602534217, "BTCUSDT|1793602534217|Buy|0.048|77864.70"})
	wantEqual(t, len(fromBybit(near0)), 3)
	first := btc["data"].([]any)[0].(obj)
	first["S"] = "Sell"
	wantEqual(t, fromBybit(btc)[0].Long, false)
	wantEqual(t, len(fromBybit(obj{"success": true, "op": "subscribe"})), 0) // a subscription's answer is no liquidation
}

func TestBinanceASellOrderClosesALongWorthItsFilledCoinsAtTheirAveragePrice(t *testing.T) {
	both := list(t, fixture(t, "binanceForceOrder.json"))
	hype := both[0].(obj)
	h := fromBinance(hype)[0]
	wantEqual(t, []any{h.Venue, h.Coin, h.Long, h.At}, []any{"Binance", "HYPE", true, 1793602529095.0})
	wantNear(t, &h.USD, 2.93*86.06)
	wantNear(t, &fromBinance(both[1])[0].USD, 4306*0.0100402) // z, all filled, not l, the last fill
	hype["o"].(obj)["S"] = "BUY"
	wantEqual(t, fromBinance(hype)[0].Long, false)
}

func TestOKXContractsTimesTheCoinsInOneAtTheBankruptcyPricePushedOrListed(t *testing.T) {
	values := must[map[string]float64](t)(okxContractValues(fixture(t, "okxInstruments.json")))
	wantEqual(t, values["BTC-USDT-SWAP"], 0.01)
	pushed := list(t, fixture(t, "okxLiquidationOrders.json"))[0].(obj)
	sndk := fromOKX(pushed, values)[0]
	wantEqual(t, []any{sndk.Venue, sndk.Market, sndk.Coin, sndk.Long}, []any{"OKX", "SNDK-USDT-SWAP", "SNDK", true})
	wantNear(t, &sndk.USD, 0.298*1*1180.2)
	listed := fromOKX(fixture(t, "okxLiquidationOrdersRest.json"), values)
	wantEqual(t, len(listed), 2)
	wantNear(t, &listed[0].USD, 10*0.01*78108.2)
	wantEqual(t, len(fromOKX(pushed, map[string]float64{})), 0) // no contract size, no value
	detail := item(field(item(pushed["data"], 0), "details"), 0).(obj)
	detail["posSide"], detail["side"] = "net", "buy"
	wantEqual(t, fromOKX(pushed, values)[0].Long, false) // in net mode a buy closes a short
}

func TestGateTheHoursThatBeganWithinTheLastDayLongsAndShortsApart(t *testing.T) {
	rows := list(t, fixture(t, "gateContractStats.json"))
	last := field(rows[len(rows)-1], "time").(float64) * 1000
	day := must[Sides](t)(gateDay(rows, last+hourMilli))
	wantNear(t, &day.Long, 4656.038112+11334.060153)
	wantNear(t, &day.Short, 7.832799)
	wantEqual(t, must[Sides](t)(gateDay(rows, last+25*hourMilli)), Sides{})
}

func TestTheRecordKeepsEachLiquidationOnceFor24HoursAndAddsThemUpByCoinAndVenue(t *testing.T) {
	now := int64(1793602534217)
	record := newLiquidations(func() int64 { return now })
	one := func(venue string, long bool, usd float64, key string, at float64) Liquidation {
		return Liquidation{venue, "BTCUSDT", "BTC", long, usd, at, key}
	}
	at := float64(now)
	record.add([]Liquidation{one("Bybit", true, 100, "a", at), one("Bybit", true, 100, "a", at), one("Bybit", false, 40, "b", at), one("Binance", true, 7, "c", at)})
	record.add([]Liquidation{one("Bybit", true, 1, "old", at-25*hourMilli)}) // older than a day, never counted
	wantEqual(t, *record.byCoin()["BTC"]["Bybit"], Sides{100, 40})
	wantEqual(t, *record.byCoin()["BTC"]["Binance"], Sides{7, 0})
	wantEqual(t, record.markets("Bybit", at-hourMilli), []string{"BTCUSDT"})
	now += 24*3_600_000 + 1
	record.add([]Liquidation{one("Bybit", true, 5, "a", float64(now))}) // a day later the key is free again
	wantEqual(t, *record.byCoin()["BTC"]["Bybit"], Sides{5, 0})
	wantEqual(t, len(record.byCoin()["BTC"]), 1)
}
