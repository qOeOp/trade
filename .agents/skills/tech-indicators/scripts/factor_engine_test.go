package main

import (
	"testing"
	"time"
)

func TestFactorRegistryExportsStableMetadataAndMultiOutput(t *testing.T) {
	input := testFactorInput(220)
	catalog := map[string]catalogSpec{
		"ema":  {Category: "moving-average", Defaults: map[string]any{"period": 20, "field": "close"}, Factors: []catalogFactorSpec{{ID: "ema.value", Output: "value", Formula: "ema", Roles: []string{"regime"}}}},
		"vpci": {Category: "volume", Defaults: map[string]any{"period_short": 5, "period_long": 20}, Factors: []catalogFactorSpec{{ID: "vpci.value", Output: "value", Formula: "vpci", Roles: []string{"confirmation"}, LegacyAlias: "vpci"}}},
		"vfi": {Category: "volume", Defaults: map[string]any{"length": 30, "signalLength": 5}, Factors: []catalogFactorSpec{
			{ID: "vfi.value", Output: "value", Formula: "vfi"},
			{ID: "vfi.signal", Output: "signal", Formula: "vfi_signal"},
			{ID: "vfi.histogram", Output: "histogram", Formula: "vfi_histogram", LegacyAlias: "vfi"},
		}},
	}

	results := buildIndicatorFeatureSeries(input, []string{"ema", "vpci", "vfi"}, catalog, nil)
	assertFactorOK(t, results, "ema.value", "ema", "value")
	assertFactorOK(t, results, "vpci.value", "vpci", "value")
	assertFactorOK(t, results, "vfi.value", "vfi", "value")
	assertFactorOK(t, results, "vfi.signal", "vfi", "signal")
	assertFactorOK(t, results, "vfi.histogram", "vfi", "histogram")

	vpci := results["vpci.value"].(map[string]any)
	if vpci["legacy_alias"] != "vpci" {
		t.Fatalf("expected legacy alias vpci, got %v", vpci["legacy_alias"])
	}
}

func TestFactorRegistryReportsUnregisteredIndicator(t *testing.T) {
	results := buildIndicatorFeatureSeries(
		testFactorInput(80),
		[]string{"ichimoku"},
		map[string]catalogSpec{"ichimoku": {Category: "trend", Defaults: map[string]any{}}},
		nil,
	)
	factor := results["ichimoku.value"].(map[string]any)
	if factor["status"] != "unsupported" {
		t.Fatalf("expected unsupported, got %v", factor["status"])
	}
}

func TestPriceActionFactorsAreScaleFree(t *testing.T) {
	input := testFactorInput(20)
	closeLocation := priceActionSeries(input, "close_location")
	body := priceActionSeries(input, "body_pct")
	if closeLocation[19] < 0 || closeLocation[19] > 1 {
		t.Fatalf("close location out of range: %f", closeLocation[19])
	}
	if body[19] <= 0 || body[19] > 1 {
		t.Fatalf("unexpected body ratio: %f", body[19])
	}
}

func assertFactorOK(t *testing.T, results map[string]any, id string, indicator string, output string) {
	t.Helper()
	factor, ok := results[id].(map[string]any)
	if !ok {
		t.Fatalf("missing factor %s", id)
	}
	if factor["status"] != "ok" || factor["factor_id"] != id || factor["source_indicator"] != indicator || factor["output"] != output {
		t.Fatalf("unexpected factor metadata: %#v", factor)
	}
	if len(factor["values"].([]map[string]any)) == 0 {
		t.Fatalf("factor %s has no values", id)
	}
}

func testFactorInput(count int) *indicatorInput {
	data := &series{}
	for index := range count {
		close := 100 + float64(index)*0.2
		data.Dates = append(data.Dates, time.Unix(int64(index*4*60*60), 0).UTC())
		data.Open = append(data.Open, close-0.1)
		data.High = append(data.High, close+1)
		data.Low = append(data.Low, close-1)
		data.Close = append(data.Close, close)
		data.Volume = append(data.Volume, 1_000+float64(index%17)*10)
	}
	return &indicatorInput{Series: data}
}
