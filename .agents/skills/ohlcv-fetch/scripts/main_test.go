package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveFetchConfigUSDMSlashSymbol(t *testing.T) {
	cfg, err := resolveFetchConfig("binance", "usdm", "ETH/USDT")
	if err != nil {
		t.Fatalf("resolveFetchConfig returned error: %v", err)
	}
	if cfg.market.exchangeID != "binanceusdm" {
		t.Fatalf("exchangeID = %q, want %q", cfg.market.exchangeID, "binanceusdm")
	}
	if cfg.symbol.manifest != "ETH/USDT:USDT" {
		t.Fatalf("manifest = %q, want %q", cfg.symbol.manifest, "ETH/USDT:USDT")
	}
	if cfg.symbol.api != "ETHUSDT" {
		t.Fatalf("api = %q, want %q", cfg.symbol.api, "ETHUSDT")
	}
}

func TestResolveFetchConfigUSDMDirectSymbol(t *testing.T) {
	cfg, err := resolveFetchConfig("binance", "usdm", "ETHUSDT")
	if err != nil {
		t.Fatalf("resolveFetchConfig returned error: %v", err)
	}
	if cfg.symbol.manifest != "ETHUSDT" {
		t.Fatalf("manifest = %q, want %q", cfg.symbol.manifest, "ETHUSDT")
	}
	if cfg.symbol.api != "ETHUSDT" {
		t.Fatalf("api = %q, want %q", cfg.symbol.api, "ETHUSDT")
	}
}

func TestResolveFetchConfigCoinMSlashSymbol(t *testing.T) {
	cfg, err := resolveFetchConfig("binance", "coinm", "BTC/USD")
	if err != nil {
		t.Fatalf("resolveFetchConfig returned error: %v", err)
	}
	if cfg.symbol.manifest != "BTC/USD:BTC" {
		t.Fatalf("manifest = %q, want %q", cfg.symbol.manifest, "BTC/USD:BTC")
	}
	if cfg.symbol.api != "BTCUSD_PERP" {
		t.Fatalf("api = %q, want %q", cfg.symbol.api, "BTCUSD_PERP")
	}
}

func TestEnsureSymbolSupportedFindsMatchBeyondFirstRow(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"symbols": [
				{"symbol": "BTCUSDT", "status": "TRADING"},
				{"symbol": "ETHUSDT", "status": "TRADING"}
			]
		}`))
	}))
	defer server.Close()

	err := ensureSymbolSupported(httpClient{client: server.Client()}, fetchConfig{
		market: marketSpec{
			baseURL:          server.URL,
			exchangeInfoPath: "/exchangeInfo",
			exchangeID:       "binanceusdm",
		},
		symbol: symbolSpec{
			manifest: "ETHUSDT",
			api:      "ETHUSDT",
		},
	})
	if err != nil {
		t.Fatalf("ensureSymbolSupported returned error: %v", err)
	}
}

func TestEnsureSymbolSupportedRejectsNonTradingSymbol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"symbols": [
				{"symbol": "TSMUSDT", "status": "BREAK"}
			]
		}`))
	}))
	defer server.Close()

	err := ensureSymbolSupported(httpClient{client: server.Client()}, fetchConfig{
		market: marketSpec{
			baseURL:          server.URL,
			exchangeInfoPath: "/exchangeInfo",
			exchangeID:       "binanceusdm",
		},
		symbol: symbolSpec{
			manifest: "TSMUSDT",
			api:      "TSMUSDT",
		},
	})
	if err == nil {
		t.Fatal("ensureSymbolSupported succeeded, want error")
	}
}
