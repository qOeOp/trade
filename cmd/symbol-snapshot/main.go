package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	spotBaseURL    = "https://api.binance.com"
	usdmBaseURL    = "https://fapi.binance.com"
	defaultTimeout = 10 * time.Second
	defaultRetries = 3
)

type config struct {
	symbol   string
	exchange string
	market   string
}

type marketSpec struct {
	baseURL          string
	exchangeID       string
	exchangeInfoPath string
	ticker24hrPath   string
	premiumIndexPath string
	openInterestPath string
}

type symbolSpec struct {
	manifest string
	api      string
}

type snapshotConfig struct {
	market marketSpec
	symbol symbolSpec
}

type responseData struct {
	Symbol            string                `json:"symbol"`
	RequestedSymbol   string                `json:"requested_symbol"`
	Exchange          string                `json:"exchange"`
	RequestedExchange string                `json:"requested_exchange"`
	Market            string                `json:"market"`
	GeneratedAt       string                `json:"generated_at"`
	Ticker24h         ticker24hSnapshot     `json:"ticker_24h"`
	PremiumIndex      *premiumIndexSnapshot `json:"premium_index,omitempty"`
	OpenInterest      *openInterestSnapshot `json:"open_interest,omitempty"`
}

type ticker24hSnapshot struct {
	Symbol             string   `json:"symbol"`
	LastPrice          float64  `json:"last_price"`
	PriceChange        float64  `json:"price_change"`
	PriceChangePercent float64  `json:"price_change_percent"`
	WeightedAvgPrice   float64  `json:"weighted_avg_price"`
	OpenPrice          float64  `json:"open_price"`
	HighPrice          float64  `json:"high_price"`
	LowPrice           float64  `json:"low_price"`
	Volume             float64  `json:"volume"`
	QuoteVolume        float64  `json:"quote_volume"`
	BidPrice           *float64 `json:"bid_price,omitempty"`
	AskPrice           *float64 `json:"ask_price,omitempty"`
	TradeCount         int64    `json:"trade_count"`
	OpenTime           int64    `json:"open_time"`
	CloseTime          int64    `json:"close_time"`
}

type premiumIndexSnapshot struct {
	Symbol               string  `json:"symbol"`
	MarkPrice            float64 `json:"mark_price"`
	IndexPrice           float64 `json:"index_price"`
	EstimatedSettlePrice float64 `json:"estimated_settle_price"`
	LastFundingRate      float64 `json:"last_funding_rate"`
	InterestRate         float64 `json:"interest_rate"`
	NextFundingTime      int64   `json:"next_funding_time"`
	Time                 int64   `json:"time"`
}

type openInterestSnapshot struct {
	Symbol       string  `json:"symbol"`
	OpenInterest float64 `json:"open_interest"`
	Time         int64   `json:"time"`
}

type exchangeInfoPayload struct {
	Symbols []symbolInfo `json:"symbols"`
}

type symbolInfo struct {
	Symbol string `json:"symbol"`
	Status string `json:"status"`
}

type ticker24hPayload struct {
	Symbol             string `json:"symbol"`
	LastPrice          string `json:"lastPrice"`
	PriceChange        string `json:"priceChange"`
	PriceChangePercent string `json:"priceChangePercent"`
	WeightedAvgPrice   string `json:"weightedAvgPrice"`
	OpenPrice          string `json:"openPrice"`
	HighPrice          string `json:"highPrice"`
	LowPrice           string `json:"lowPrice"`
	Volume             string `json:"volume"`
	QuoteVolume        string `json:"quoteVolume"`
	BidPrice           string `json:"bidPrice"`
	AskPrice           string `json:"askPrice"`
	Count              int64  `json:"count"`
	OpenTime           int64  `json:"openTime"`
	CloseTime          int64  `json:"closeTime"`
}

type premiumIndexPayload struct {
	Symbol               string `json:"symbol"`
	MarkPrice            string `json:"markPrice"`
	IndexPrice           string `json:"indexPrice"`
	EstimatedSettlePrice string `json:"estimatedSettlePrice"`
	LastFundingRate      string `json:"lastFundingRate"`
	InterestRate         string `json:"interestRate"`
	NextFundingTime      int64  `json:"nextFundingTime"`
	Time                 int64  `json:"time"`
}

type openInterestPayload struct {
	Symbol       string `json:"symbol"`
	OpenInterest string `json:"openInterest"`
	Time         int64  `json:"time"`
}

type httpClient struct {
	client  *http.Client
	retries int
}

func main() {
	if err := run(); err != nil {
		writeJSON(os.Stderr, map[string]any{"ok": false, "error": err.Error()})
		os.Exit(1)
	}
}

func run() error {
	cfg, err := parseFlags()
	if err != nil {
		return err
	}

	snapshotCfg, err := resolveSnapshotConfig(cfg.exchange, cfg.market, cfg.symbol)
	if err != nil {
		return err
	}

	client := httpClient{
		client:  &http.Client{Timeout: defaultTimeout},
		retries: defaultRetries,
	}
	if err := ensureSymbolSupported(client, snapshotCfg); err != nil {
		return err
	}

	payload, err := collectSnapshot(client, cfg, snapshotCfg)
	if err != nil {
		return err
	}

	writeJSON(os.Stdout, map[string]any{"ok": true, "data": payload})
	return nil
}

func parseFlags() (config, error) {
	var cfg config
	flag.StringVar(&cfg.symbol, "symbol", "", "Symbol such as BTCUSDT or BTC/USDT")
	flag.StringVar(&cfg.exchange, "exchange", "binance", "Exchange, only Binance is supported")
	flag.StringVar(&cfg.market, "market", "usdm", "Market: spot or usdm")
	flag.Parse()

	cfg.symbol = strings.TrimSpace(cfg.symbol)
	cfg.exchange = strings.ToLower(strings.TrimSpace(cfg.exchange))
	cfg.market = strings.ToLower(strings.TrimSpace(cfg.market))

	if cfg.symbol == "" {
		return cfg, errors.New("--symbol is required")
	}
	if cfg.exchange != "binance" && cfg.exchange != "binanceusdm" {
		return cfg, fmt.Errorf("unsupported exchange: %s", cfg.exchange)
	}
	switch cfg.market {
	case "spot", "usdm":
	default:
		return cfg, fmt.Errorf("unsupported market: %s", cfg.market)
	}
	return cfg, nil
}

func collectSnapshot(client httpClient, cfg config, snapshotCfg snapshotConfig) (responseData, error) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}

	tickerData, err := fetchTicker24h(client, snapshotCfg)
	if err != nil {
		return responseData{}, err
	}

	tickerSnapshot := ticker24hSnapshot{
		Symbol:             tickerData.Symbol,
		LastPrice:          parseFloat(tickerData.LastPrice),
		PriceChange:        parseFloat(tickerData.PriceChange),
		PriceChangePercent: parseFloat(tickerData.PriceChangePercent),
		WeightedAvgPrice:   parseFloat(tickerData.WeightedAvgPrice),
		OpenPrice:          parseFloat(tickerData.OpenPrice),
		HighPrice:          parseFloat(tickerData.HighPrice),
		LowPrice:           parseFloat(tickerData.LowPrice),
		Volume:             parseFloat(tickerData.Volume),
		QuoteVolume:        parseFloat(tickerData.QuoteVolume),
		TradeCount:         tickerData.Count,
		OpenTime:           tickerData.OpenTime,
		CloseTime:          tickerData.CloseTime,
	}
	if bidPrice, ok := parseOptionalFloat(tickerData.BidPrice); ok {
		tickerSnapshot.BidPrice = &bidPrice
	}
	if askPrice, ok := parseOptionalFloat(tickerData.AskPrice); ok {
		tickerSnapshot.AskPrice = &askPrice
	}

	payload := responseData{
		Symbol:            snapshotCfg.symbol.manifest,
		RequestedSymbol:   cfg.symbol,
		Exchange:          snapshotCfg.market.exchangeID,
		RequestedExchange: cfg.exchange,
		Market:            cfg.market,
		GeneratedAt:       time.Now().In(loc).Format(time.RFC3339Nano),
		Ticker24h:         tickerSnapshot,
	}

	if snapshotCfg.market.premiumIndexPath != "" {
		premiumData, err := fetchPremiumIndex(client, snapshotCfg)
		if err != nil {
			return responseData{}, err
		}
		payload.PremiumIndex = &premiumIndexSnapshot{
			Symbol:               premiumData.Symbol,
			MarkPrice:            parseFloat(premiumData.MarkPrice),
			IndexPrice:           parseFloat(premiumData.IndexPrice),
			EstimatedSettlePrice: parseFloat(premiumData.EstimatedSettlePrice),
			LastFundingRate:      parseFloat(premiumData.LastFundingRate),
			InterestRate:         parseFloat(premiumData.InterestRate),
			NextFundingTime:      premiumData.NextFundingTime,
			Time:                 premiumData.Time,
		}
	}

	if snapshotCfg.market.openInterestPath != "" {
		openInterestData, err := fetchOpenInterest(client, snapshotCfg)
		if err != nil {
			return responseData{}, err
		}
		payload.OpenInterest = &openInterestSnapshot{
			Symbol:       openInterestData.Symbol,
			OpenInterest: parseFloat(openInterestData.OpenInterest),
			Time:         openInterestData.Time,
		}
	}

	return payload, nil
}

func resolveSnapshotConfig(exchange, market, rawSymbol string) (snapshotConfig, error) {
	marketSpec, err := resolveMarketSpec(exchange, market)
	if err != nil {
		return snapshotConfig{}, err
	}
	symbol, err := resolveSymbolSpec(rawSymbol, market)
	if err != nil {
		return snapshotConfig{}, err
	}
	return snapshotConfig{
		market: marketSpec,
		symbol: symbol,
	}, nil
}

func resolveMarketSpec(exchange, market string) (marketSpec, error) {
	switch market {
	case "spot":
		if exchange != "binance" {
			return marketSpec{}, fmt.Errorf("spot only supports exchange=binance, got %s", exchange)
		}
		return marketSpec{
			baseURL:          spotBaseURL,
			exchangeID:       "binance",
			exchangeInfoPath: "/api/v3/exchangeInfo",
			ticker24hrPath:   "/api/v3/ticker/24hr",
		}, nil
	case "usdm":
		if exchange != "binance" && exchange != "binanceusdm" {
			return marketSpec{}, fmt.Errorf("usdm only supports Binance USD-M, got %s", exchange)
		}
		return marketSpec{
			baseURL:          usdmBaseURL,
			exchangeID:       "binanceusdm",
			exchangeInfoPath: "/fapi/v1/exchangeInfo",
			ticker24hrPath:   "/fapi/v1/ticker/24hr",
			premiumIndexPath: "/fapi/v1/premiumIndex",
			openInterestPath: "/fapi/v1/openInterest",
		}, nil
	default:
		return marketSpec{}, fmt.Errorf("unsupported market: %s", market)
	}
}

func resolveSymbolSpec(rawSymbol, market string) (symbolSpec, error) {
	trimmed := strings.ToUpper(strings.TrimSpace(rawSymbol))
	if trimmed == "" {
		return symbolSpec{}, errors.New("symbol cannot be empty")
	}
	if strings.Contains(trimmed, ":") || !strings.Contains(trimmed, "/") {
		return symbolSpec{
			manifest: trimmed,
			api:      resolveAPISymbol(trimmed),
		}, nil
	}

	parts := strings.SplitN(trimmed, "/", 2)
	base := parts[0]
	quote := parts[1]
	if market == "usdm" {
		return symbolSpec{
			manifest: base + "/" + quote + ":" + quote,
			api:      base + quote,
		}, nil
	}
	return symbolSpec{
		manifest: trimmed,
		api:      base + quote,
	}, nil
}

func resolveAPISymbol(rawSymbol string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(rawSymbol))
	if strings.Contains(trimmed, ":") {
		trimmed = strings.SplitN(trimmed, ":", 2)[0]
	}
	if strings.Contains(trimmed, "/") {
		parts := strings.SplitN(trimmed, "/", 2)
		return parts[0] + parts[1]
	}
	return trimmed
}

func ensureSymbolSupported(client httpClient, cfg snapshotConfig) error {
	body, err := client.get(cfg.market.baseURL + cfg.market.exchangeInfoPath)
	if err != nil {
		return err
	}

	var payload exchangeInfoPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}

	for _, symbol := range payload.Symbols {
		if symbol.Symbol != cfg.symbol.api {
			continue
		}
		if symbol.Status != "TRADING" {
			return fmt.Errorf("%s exists but is not tradable on %s", cfg.symbol.manifest, cfg.market.exchangeID)
		}
		return nil
	}
	return fmt.Errorf("%s is not supported on %s", cfg.symbol.manifest, cfg.market.exchangeID)
}

func fetchTicker24h(client httpClient, cfg snapshotConfig) (ticker24hPayload, error) {
	query := url.Values{}
	query.Set("symbol", cfg.symbol.api)
	body, err := client.get(cfg.market.baseURL + cfg.market.ticker24hrPath + "?" + query.Encode())
	if err != nil {
		return ticker24hPayload{}, err
	}

	var payload ticker24hPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return ticker24hPayload{}, err
	}
	return payload, nil
}

func fetchPremiumIndex(client httpClient, cfg snapshotConfig) (premiumIndexPayload, error) {
	query := url.Values{}
	query.Set("symbol", cfg.symbol.api)
	body, err := client.get(cfg.market.baseURL + cfg.market.premiumIndexPath + "?" + query.Encode())
	if err != nil {
		return premiumIndexPayload{}, err
	}

	var payload premiumIndexPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return premiumIndexPayload{}, err
	}
	return payload, nil
}

func fetchOpenInterest(client httpClient, cfg snapshotConfig) (openInterestPayload, error) {
	query := url.Values{}
	query.Set("symbol", cfg.symbol.api)
	body, err := client.get(cfg.market.baseURL + cfg.market.openInterestPath + "?" + query.Encode())
	if err != nil {
		return openInterestPayload{}, err
	}

	var payload openInterestPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return openInterestPayload{}, err
	}
	return payload, nil
}

func parseFloat(raw string) float64 {
	value, _ := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return value
}

func parseOptionalFloat(raw string) (float64, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, false
	}
	return value, true
}

func (c httpClient) get(rawURL string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < c.retries; attempt++ {
		body, err := c.doGet(rawURL)
		if err == nil {
			return body, nil
		}
		lastErr = err
		if attempt < c.retries-1 {
			time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
		}
	}
	if lastErr == nil {
		lastErr = errors.New("request failed")
	}
	return nil, lastErr
}

func (c httpClient) doGet(rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("%s returned %s: %s", rawURL, resp.Status, strings.TrimSpace(string(body)))
	}
	return body, nil
}

func writeJSON(w io.Writer, payload any) {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(payload)
}
