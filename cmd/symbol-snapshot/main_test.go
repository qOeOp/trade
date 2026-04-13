package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveSnapshotConfigUSDMSlashSymbol(t *testing.T) {
	cfg, err := resolveSnapshotConfig("binance", "usdm", "BTC/USDT")
	if err != nil {
		t.Fatalf("resolveSnapshotConfig returned error: %v", err)
	}
	if cfg.market.exchangeID != "binanceusdm" {
		t.Fatalf("exchangeID = %q, want %q", cfg.market.exchangeID, "binanceusdm")
	}
	if cfg.symbol.manifest != "BTC/USDT:USDT" {
		t.Fatalf("manifest = %q, want %q", cfg.symbol.manifest, "BTC/USDT:USDT")
	}
	if cfg.symbol.api != "BTCUSDT" {
		t.Fatalf("api = %q, want %q", cfg.symbol.api, "BTCUSDT")
	}
}

func TestResolveSnapshotConfigSpotSymbol(t *testing.T) {
	cfg, err := resolveSnapshotConfig("binance", "spot", "ETH/USDT")
	if err != nil {
		t.Fatalf("resolveSnapshotConfig returned error: %v", err)
	}
	if cfg.market.exchangeID != "binance" {
		t.Fatalf("exchangeID = %q, want %q", cfg.market.exchangeID, "binance")
	}
	if cfg.symbol.manifest != "ETH/USDT" {
		t.Fatalf("manifest = %q, want %q", cfg.symbol.manifest, "ETH/USDT")
	}
	if cfg.symbol.api != "ETHUSDT" {
		t.Fatalf("api = %q, want %q", cfg.symbol.api, "ETHUSDT")
	}
}

func TestCollectSnapshotUSDMPopulatesDerivativesFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/exchangeInfo":
			_, _ = w.Write([]byte(`{"symbols":[{"symbol":"BTCUSDT","status":"TRADING"}]}`))
		case "/ticker24hr":
			_, _ = w.Write([]byte(`{
				"symbol":"BTCUSDT",
				"lastPrice":"72677.30",
				"priceChange":"1212.90",
				"priceChangePercent":"1.697",
				"weightedAvgPrice":"72626.21",
				"openPrice":"71464.40",
				"highPrice":"73450.00",
				"lowPrice":"71395.00",
				"volume":"140285.407",
				"quoteVolume":"10188397984.09",
				"bidPrice":"72677.20",
				"askPrice":"72677.30",
				"count":3005728,
				"openTime":1775808060000,
				"closeTime":1775894516058
			}`))
		case "/premiumIndex":
			_, _ = w.Write([]byte(`{
				"symbol":"BTCUSDT",
				"markPrice":"72677.20000000",
				"indexPrice":"72722.96804348",
				"estimatedSettlePrice":"72743.12730917",
				"lastFundingRate":"-0.00006067",
				"interestRate":"0.00010000",
				"nextFundingTime":1775923200000,
				"time":1775894519003
			}`))
		case "/openInterest":
			_, _ = w.Write([]byte(`{
				"symbol":"BTCUSDT",
				"openInterest":"51234.12300000",
				"time":1775894519003
			}`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := httpClient{
		client:  server.Client(),
		retries: 1,
	}
	cfg := config{
		symbol:   "BTCUSDT",
		exchange: "binance",
		market:   "usdm",
	}
	snapshotCfg := snapshotConfig{
		market: marketSpec{
			baseURL:          server.URL,
			exchangeID:       "binanceusdm",
			exchangeInfoPath: "/exchangeInfo",
			ticker24hrPath:   "/ticker24hr",
			premiumIndexPath: "/premiumIndex",
			openInterestPath: "/openInterest",
		},
		symbol: symbolSpec{
			manifest: "BTCUSDT",
			api:      "BTCUSDT",
		},
	}

	if err := ensureSymbolSupported(client, snapshotCfg); err != nil {
		t.Fatalf("ensureSymbolSupported returned error: %v", err)
	}

	payload, err := collectSnapshot(client, cfg, snapshotCfg)
	if err != nil {
		t.Fatalf("collectSnapshot returned error: %v", err)
	}
	if payload.Ticker24h.LastPrice != 72677.30 {
		t.Fatalf("last price = %v, want 72677.30", payload.Ticker24h.LastPrice)
	}
	if payload.PremiumIndex == nil {
		t.Fatal("premium index missing")
	}
	if payload.PremiumIndex.LastFundingRate != -0.00006067 {
		t.Fatalf("funding rate = %v, want -0.00006067", payload.PremiumIndex.LastFundingRate)
	}
	if payload.OpenInterest == nil {
		t.Fatal("open interest missing")
	}
	if payload.OpenInterest.OpenInterest != 51234.123 {
		t.Fatalf("open interest = %v, want 51234.123", payload.OpenInterest.OpenInterest)
	}
}
