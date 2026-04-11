package main

import "testing"

func TestSplitOrdersAddsSourceFields(t *testing.T) {
	orders := []map[string]any{
		{
			"symbol":       "ETHUSDT",
			"side":         "BUY",
			"type":         "LIMIT",
			"status":       "NEW",
			"origQty":      "2",
			"price":        "2148",
			"stopPrice":    "0",
			"timeInForce":  "GTC",
			"orderId":      123,
			"positionSide": "LONG",
		},
		{
			"symbol":       "BTCUSDT",
			"side":         "SELL",
			"type":         "STOP_MARKET",
			"status":       "NEW",
			"origQty":      "0.4",
			"price":        "0",
			"stopPrice":    "71960",
			"timeInForce":  "GTE_GTC",
			"orderId":      456,
			"positionSide": "LONG",
		},
	}

	split := splitOrders(orders, isFuturesProtective, normalizeStandardOrder("openOrders", "standard"))

	if len(split.Regular) != 1 {
		t.Fatalf("expected 1 regular order, got %d", len(split.Regular))
	}
	if len(split.Protective) != 1 {
		t.Fatalf("expected 1 protective order, got %d", len(split.Protective))
	}
	if split.Regular[0]["source"] != "openOrders" || split.Regular[0]["sourceType"] != "standard" {
		t.Fatalf("expected regular source markers, got %v / %v", split.Regular[0]["source"], split.Regular[0]["sourceType"])
	}
	if split.Protective[0]["source"] != "openOrders" || split.Protective[0]["sourceType"] != "standard" {
		t.Fatalf("expected protective source markers, got %v / %v", split.Protective[0]["source"], split.Protective[0]["sourceType"])
	}
}

func TestNormalizeFuturesAlgoOrderAddsSourceFields(t *testing.T) {
	order := map[string]any{
		"algoId":        456,
		"clientAlgoId":  "stToAg_OTOCO_1_2",
		"orderType":     "TAKE_PROFIT_MARKET",
		"symbol":        "NEARUSDT",
		"side":          "SELL",
		"positionSide":  "LONG",
		"timeInForce":   "GTE_GTC",
		"quantity":      "2000.0",
		"algoStatus":    "NEW",
		"triggerPrice":  "1.389",
		"price":         "0.0",
		"closePosition": false,
		"reduceOnly":    true,
		"workingType":   "CONTRACT_PRICE",
		"priceProtect":  true,
	}

	normalized := normalizeFuturesAlgoOrder("openAlgoOrders", "algo")(order)

	if normalized["type"] != "TAKE_PROFIT_MARKET" {
		t.Fatalf("expected algo order type to be preserved, got %v", normalized["type"])
	}
	if normalized["stopPrice"] != "1.389" {
		t.Fatalf("expected triggerPrice to map to stopPrice, got %v", normalized["stopPrice"])
	}
	if normalized["algoId"] != 456 {
		t.Fatalf("expected algoId to be preserved, got %v", normalized["algoId"])
	}
	if normalized["source"] != "openAlgoOrders" || normalized["sourceType"] != "algo" {
		t.Fatalf("expected algo source markers, got %v / %v", normalized["source"], normalized["sourceType"])
	}
}

func TestAppendProtectiveOrdersMergesHistoryBuckets(t *testing.T) {
	standardHistory := []map[string]any{
		{
			"symbol":      "NEARUSDT",
			"side":        "BUY",
			"type":        "LIMIT",
			"status":      "FILLED",
			"origQty":     "2000",
			"price":       "1.345",
			"stopPrice":   "0",
			"timeInForce": "GTC",
			"orderId":     789,
		},
	}
	algoHistory := []map[string]any{
		{
			"algoId":       1001,
			"orderType":    "STOP_MARKET",
			"symbol":       "NEARUSDT",
			"side":         "SELL",
			"positionSide": "LONG",
			"timeInForce":  "GTE_GTC",
			"quantity":     "2000",
			"algoStatus":   "NEW",
			"triggerPrice": "1.3290",
			"price":        "0.0000",
		},
	}

	history := splitOrders(standardHistory, isFuturesProtective, normalizeStandardOrder("allOrders", "standard"))
	historyBuckets := appendProtectiveOrders(&history, algoHistory, normalizeFuturesAlgoOrder("allAlgoOrders", "algo"))

	if len(historyBuckets.Regular) != 1 {
		t.Fatalf("expected 1 regular history order, got %d", len(historyBuckets.Regular))
	}
	if len(historyBuckets.Protective) != 1 {
		t.Fatalf("expected 1 protective history order, got %d", len(historyBuckets.Protective))
	}
	if historyBuckets.Regular[0]["source"] != "allOrders" {
		t.Fatalf("expected regular history source allOrders, got %v", historyBuckets.Regular[0]["source"])
	}
	if historyBuckets.Protective[0]["source"] != "allAlgoOrders" {
		t.Fatalf("expected protective history source allAlgoOrders, got %v", historyBuckets.Protective[0]["source"])
	}
}
