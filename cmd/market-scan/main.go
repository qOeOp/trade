package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	spotBaseURL             = "https://api.binance.com"
	usdmBaseURL             = "https://fapi.binance.com"
	defaultTimeout          = 20 * time.Second
	defaultRetries          = 3
	defaultMinQuoteVolume   = 20_000_000
	defaultCandidateLimit   = 10
	eventRiskChangePercent  = 15
	highLiquidityQuoteValue = 1_000_000_000
	liquidQuoteValue        = 100_000_000
)

type config struct {
	exchange       string
	market         string
	direction      string
	minQuoteVolume float64
	limit          int
}

type marketSpec struct {
	baseURL          string
	exchangeID       string
	exchangeInfoPath string
	ticker24hrPath   string
}

type exchangeInfoPayload struct {
	Symbols []symbolInfo `json:"symbols"`
}

type symbolInfo struct {
	Symbol       string `json:"symbol"`
	Status       string `json:"status"`
	QuoteAsset   string `json:"quoteAsset"`
	ContractType string `json:"contractType"`
}

type ticker24hr struct {
	Symbol             string `json:"symbol"`
	LastPrice          string `json:"lastPrice"`
	PriceChangePercent string `json:"priceChangePercent"`
	QuoteVolume        string `json:"quoteVolume"`
	Count              int64  `json:"count"`
}

type candidate struct {
	Symbol             string   `json:"symbol"`
	LastPrice          float64  `json:"last_price"`
	PriceChangePercent float64  `json:"price_change_percent"`
	QuoteVolume        float64  `json:"quote_volume"`
	TradeCount         int64    `json:"trade_count"`
	Score              float64  `json:"score"`
	Tags               []string `json:"tags"`
}

type responseData struct {
	Exchange          string        `json:"exchange"`
	RequestedExchange string        `json:"requested_exchange"`
	Market            string        `json:"market"`
	GeneratedAt       string        `json:"generated_at"`
	Filters           responseRules `json:"filters"`
	Summary           summary       `json:"summary"`
	Candidates        candidates    `json:"candidates"`
}

type responseRules struct {
	Direction      string  `json:"direction"`
	MinQuoteVolume float64 `json:"min_quote_volume"`
	Limit          int     `json:"limit"`
}

type summary struct {
	TradableSymbols int `json:"tradable_symbols"`
	TickerRows      int `json:"ticker_rows"`
	EligibleSymbols int `json:"eligible_symbols"`
}

type candidates struct {
	Long  []candidate `json:"long"`
	Short []candidate `json:"short"`
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

	market, err := resolveMarket(cfg.exchange, cfg.market)
	if err != nil {
		return err
	}

	client := httpClient{
		client:  &http.Client{Timeout: defaultTimeout},
		retries: defaultRetries,
	}

	tradable, err := fetchTradableSymbols(client, market)
	if err != nil {
		return err
	}

	tickers, err := fetchTicker24h(client, market)
	if err != nil {
		return err
	}

	longs, shorts, eligible := buildCandidates(tradable, tickers, cfg)

	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}

	payload := responseData{
		Exchange:          market.exchangeID,
		RequestedExchange: cfg.exchange,
		Market:            cfg.market,
		GeneratedAt:       time.Now().In(loc).Format(time.RFC3339Nano),
		Filters: responseRules{
			Direction:      cfg.direction,
			MinQuoteVolume: cfg.minQuoteVolume,
			Limit:          cfg.limit,
		},
		Summary: summary{
			TradableSymbols: len(tradable),
			TickerRows:      len(tickers),
			EligibleSymbols: eligible,
		},
		Candidates: candidates{
			Long:  longs,
			Short: shorts,
		},
	}

	writeJSON(os.Stdout, map[string]any{"ok": true, "data": payload})
	return nil
}

func parseFlags() (config, error) {
	cfg := config{}
	flag.StringVar(&cfg.exchange, "exchange", "binance", "Exchange, only Binance is supported")
	flag.StringVar(&cfg.market, "market", "usdm", "Market: spot or usdm")
	flag.StringVar(&cfg.direction, "direction", "both", "Scan direction: both, long, or short")
	flag.Float64Var(&cfg.minQuoteVolume, "min-quote-volume", defaultMinQuoteVolume, "Minimum 24h quote volume")
	flag.IntVar(&cfg.limit, "limit", defaultCandidateLimit, "Number of candidates to return per side")
	flag.Parse()

	cfg.exchange = strings.ToLower(strings.TrimSpace(cfg.exchange))
	cfg.market = strings.ToLower(strings.TrimSpace(cfg.market))
	cfg.direction = strings.ToLower(strings.TrimSpace(cfg.direction))

	if cfg.exchange != "binance" && cfg.exchange != "binanceusdm" {
		return cfg, fmt.Errorf("unsupported exchange: %s", cfg.exchange)
	}
	switch cfg.market {
	case "spot", "usdm":
	default:
		return cfg, fmt.Errorf("unsupported market: %s", cfg.market)
	}
	switch cfg.direction {
	case "both", "long", "short":
	default:
		return cfg, fmt.Errorf("unsupported direction: %s", cfg.direction)
	}
	if cfg.minQuoteVolume < 0 {
		return cfg, errors.New("--min-quote-volume cannot be negative")
	}
	if cfg.limit <= 0 {
		return cfg, errors.New("--limit must be greater than 0")
	}
	return cfg, nil
}

func resolveMarket(exchange, market string) (marketSpec, error) {
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
		}, nil
	default:
		return marketSpec{}, fmt.Errorf("unsupported market: %s", market)
	}
}

func fetchTradableSymbols(client httpClient, market marketSpec) (map[string]struct{}, error) {
	body, err := client.get(market.baseURL + market.exchangeInfoPath)
	if err != nil {
		return nil, err
	}

	var payload exchangeInfoPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	tradable := make(map[string]struct{}, len(payload.Symbols))
	for _, symbol := range payload.Symbols {
		if symbol.Status != "TRADING" {
			continue
		}
		switch market.exchangeID {
		case "binance":
			if symbol.QuoteAsset != "USDT" {
				continue
			}
		case "binanceusdm":
			if symbol.QuoteAsset != "USDT" || symbol.ContractType != "PERPETUAL" {
				continue
			}
		}
		tradable[symbol.Symbol] = struct{}{}
	}
	return tradable, nil
}

func fetchTicker24h(client httpClient, market marketSpec) ([]ticker24hr, error) {
	query := url.Values{}
	body, err := client.get(market.baseURL + market.ticker24hrPath + "?" + query.Encode())
	if err != nil {
		return nil, err
	}

	var payload []ticker24hr
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func buildCandidates(tradable map[string]struct{}, tickers []ticker24hr, cfg config) ([]candidate, []candidate, int) {
	longs := make([]candidate, 0, cfg.limit)
	shorts := make([]candidate, 0, cfg.limit)
	eligible := 0

	for _, ticker := range tickers {
		if _, ok := tradable[ticker.Symbol]; !ok {
			continue
		}

		lastPrice, ok := parseFloat(ticker.LastPrice)
		if !ok {
			continue
		}
		changePct, ok := parseFloat(ticker.PriceChangePercent)
		if !ok {
			continue
		}
		quoteVolume, ok := parseFloat(ticker.QuoteVolume)
		if !ok || quoteVolume < cfg.minQuoteVolume {
			continue
		}

		eligible++
		item := candidate{
			Symbol:             ticker.Symbol,
			LastPrice:          lastPrice,
			PriceChangePercent: changePct,
			QuoteVolume:        quoteVolume,
			TradeCount:         ticker.Count,
			Score:              scoreCandidate(changePct, quoteVolume),
			Tags:               buildTags(changePct, quoteVolume),
		}

		switch {
		case changePct > 0 && cfg.direction != "short":
			longs = append(longs, item)
		case changePct < 0 && cfg.direction != "long":
			shorts = append(shorts, item)
		}
	}

	slices.SortFunc(longs, func(a, b candidate) int {
		if cmp := compareFloatDesc(a.Score, b.Score); cmp != 0 {
			return cmp
		}
		return compareFloatDesc(a.QuoteVolume, b.QuoteVolume)
	})
	slices.SortFunc(shorts, func(a, b candidate) int {
		if cmp := compareFloatDesc(a.Score, b.Score); cmp != 0 {
			return cmp
		}
		return compareFloatDesc(a.QuoteVolume, b.QuoteVolume)
	})

	if len(longs) > cfg.limit {
		longs = longs[:cfg.limit]
	}
	if len(shorts) > cfg.limit {
		shorts = shorts[:cfg.limit]
	}

	return longs, shorts, eligible
}

func parseFloat(raw string) (float64, bool) {
	value, err := strconvParseFloat(raw)
	if err != nil {
		return 0, false
	}
	return value, true
}

func scoreCandidate(changePct, quoteVolume float64) float64 {
	liquidity := math.Log10(math.Max(quoteVolume, 1))
	return math.Abs(changePct) * liquidity
}

func buildTags(changePct, quoteVolume float64) []string {
	tags := make([]string, 0, 3)
	switch {
	case quoteVolume >= highLiquidityQuoteValue:
		tags = append(tags, "very-liquid")
	case quoteVolume >= liquidQuoteValue:
		tags = append(tags, "liquid")
	default:
		tags = append(tags, "tradable")
	}

	switch {
	case changePct >= 0:
		tags = append(tags, "trend-up-day")
	default:
		tags = append(tags, "trend-down-day")
	}

	if math.Abs(changePct) >= eventRiskChangePercent {
		tags = append(tags, "event-risk")
	}
	return tags
}

func compareFloatDesc(a, b float64) int {
	switch {
	case a > b:
		return -1
	case a < b:
		return 1
	default:
		return 0
	}
}

func writeJSON(w io.Writer, payload any) {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(payload)
}

func (c httpClient) get(target string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < c.retries; attempt++ {
		body, err := c.getOnce(target)
		if err == nil {
			return body, nil
		}
		lastErr = err
		if attempt == c.retries-1 {
			break
		}
		time.Sleep(time.Duration(attempt+1) * 250 * time.Millisecond)
	}
	return nil, lastErr
}

func (c httpClient) getOnce(target string) ([]byte, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "trade-market-scan/1.0")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return body, nil
	}
	return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func strconvParseFloat(raw string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(raw), 64)
}
