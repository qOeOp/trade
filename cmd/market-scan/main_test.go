package main

import "testing"

func TestBuildCandidatesFiltersAndSorts(t *testing.T) {
	tradable := map[string]struct{}{
		"SOLUSDT":  {},
		"ETHUSDT":  {},
		"ENAUSDT":  {},
		"NEARUSDT": {},
	}
	tickers := []ticker24hr{
		{Symbol: "SOLUSDT", LastPrice: "84.0", PriceChangePercent: "2.4", QuoteVolume: "1400000000", Count: 100},
		{Symbol: "ETHUSDT", LastPrice: "2230", PriceChangePercent: "1.2", QuoteVolume: "7900000000", Count: 100},
		{Symbol: "ENAUSDT", LastPrice: "0.094", PriceChangePercent: "-4.4", QuoteVolume: "138000000", Count: 100},
		{Symbol: "NEARUSDT", LastPrice: "1.33", PriceChangePercent: "-1.4", QuoteVolume: "103000000", Count: 100},
		{Symbol: "LOWUSDT", LastPrice: "1", PriceChangePercent: "10", QuoteVolume: "1000000", Count: 10},
	}

	longs, shorts, eligible := buildCandidates(tradable, tickers, config{
		direction:      "both",
		minQuoteVolume: 20_000_000,
		limit:          5,
	})

	if eligible != 4 {
		t.Fatalf("eligible = %d, want 4", eligible)
	}
	if len(longs) != 2 {
		t.Fatalf("len(longs) = %d, want 2", len(longs))
	}
	if len(shorts) != 2 {
		t.Fatalf("len(shorts) = %d, want 2", len(shorts))
	}
	if longs[0].Symbol != "SOLUSDT" {
		t.Fatalf("longs[0] = %s, want SOLUSDT", longs[0].Symbol)
	}
	if shorts[0].Symbol != "ENAUSDT" {
		t.Fatalf("shorts[0] = %s, want ENAUSDT", shorts[0].Symbol)
	}
}

func TestBuildTagsMarksEventRisk(t *testing.T) {
	tags := buildTags(21.5, 250_000_000)
	if len(tags) != 3 {
		t.Fatalf("len(tags) = %d, want 3", len(tags))
	}
	if tags[2] != "event-risk" {
		t.Fatalf("tags[2] = %q, want event-risk", tags[2])
	}
}
