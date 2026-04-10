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
	"strings"
	"time"
)

const (
	spotBaseURL    = "https://api.binance.com"
	usdmBaseURL    = "https://fapi.binance.com"
	coinmBaseURL   = "https://dapi.binance.com"
	defaultTimeout = 10 * time.Second
)

var (
	defaultLimits = map[string]int{
		"1w": 300,
		"1d": 320,
		"4h": 420,
		"1h": 520,
	}
	timeframeOrder = []string{"1w", "1d", "4h", "1h"}
)

type config struct {
	symbol     string
	exchange   string
	marketType string
	timeframes string
	limit      int
	sinceTS    int64
}

type fetchConfig struct {
	baseURL          string
	klinesPath       string
	exchangeInfoPath string
	exchangeID       string
	manifestSymbol   string
	apiSymbol        string
}

type fetchResponse struct {
	Symbol            string                            `json:"symbol"`
	RequestedSymbol   string                            `json:"requested_symbol"`
	Exchange          string                            `json:"exchange"`
	RequestedExchange string                            `json:"requested_exchange"`
	MarketType        string                            `json:"market_type"`
	GeneratedAt       string                            `json:"generated_at"`
	Columns           []string                          `json:"columns"`
	DedupeKey         string                            `json:"dedupe_key"`
	RequestedSinceTS  *int64                            `json:"requested_since_ts,omitempty"`
	Timeframes        map[string]timeframeResponseEntry `json:"timeframes"`
}

type timeframeResponseEntry struct {
	Limit       int      `json:"limit"`
	FirstOpenTS int64    `json:"first_open_ts"`
	LastOpenTS  int64    `json:"last_open_ts"`
	Rows        int      `json:"rows"`
	Candles     []candle `json:"candles"`
	AppendOnly  bool     `json:"append_only"`
	AscendingTS bool     `json:"ascending_ts"`
}

type timeframeResult struct {
	timeframe string
	candles   []candle
	limit     int
	err       error
}

type candle struct {
	Date      string `json:"date"`
	Timestamp int64  `json:"timestamp"`
	Open      string `json:"open"`
	High      string `json:"high"`
	Low       string `json:"low"`
	Close     string `json:"close"`
	Volume    string `json:"volume"`
}

type httpClient struct {
	client *http.Client
}

func main() {
	if err := run(); err != nil {
		enc := json.NewEncoder(os.Stderr)
		enc.SetIndent("", "  ")
		_ = enc.Encode(map[string]any{"ok": false, "error": err.Error()})
		os.Exit(1)
	}
}

func run() error {
	cfg, err := parseFlags()
	if err != nil {
		return err
	}

	fetchCfg, err := resolveFetchConfig(cfg.exchange, cfg.marketType, cfg.symbol)
	if err != nil {
		return err
	}

	client := httpClient{
		client: &http.Client{Timeout: defaultTimeout},
	}
	if err := ensureSymbolSupported(client, fetchCfg); err != nil {
		return err
	}

	timeframes := orderedTimeframes(cfg.timeframes)
	if len(timeframes) == 0 {
		return fmt.Errorf("no timeframes to fetch")
	}

	results, err := fetchAllTimeframes(client, fetchCfg, timeframes, cfg.limit, cfg.sinceTS)
	if err != nil {
		return err
	}

	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}

	response := fetchResponse{
		Symbol:            fetchCfg.manifestSymbol,
		RequestedSymbol:   cfg.symbol,
		Exchange:          fetchCfg.exchangeID,
		RequestedExchange: cfg.exchange,
		MarketType:        cfg.marketType,
		GeneratedAt:       time.Now().In(loc).Format(time.RFC3339Nano),
		Columns:           []string{"date", "timestamp", "open", "high", "low", "close", "volume"},
		DedupeKey:         "timestamp",
		Timeframes:        map[string]timeframeResponseEntry{},
	}
	if cfg.sinceTS > 0 {
		response.RequestedSinceTS = &cfg.sinceTS
	}

	for _, timeframe := range timeframes {
		result := results[timeframe]
		entry := timeframeResponseEntry{
			Limit:       result.limit,
			Rows:        len(result.candles),
			Candles:     result.candles,
			AppendOnly:  true,
			AscendingTS: true,
		}
		if len(result.candles) > 0 {
			entry.FirstOpenTS = result.candles[0].Timestamp
			entry.LastOpenTS = result.candles[len(result.candles)-1].Timestamp
		}
		response.Timeframes[timeframe] = entry
	}

	out, _ := json.MarshalIndent(map[string]any{"ok": true, "data": response}, "", "  ")
	os.Stdout.Write(append(out, '\n'))
	return nil
}

func parseFlags() (config, error) {
	var cfg config
	flag.StringVar(&cfg.symbol, "symbol", "", "Symbol such as ETH/USDT")
	flag.StringVar(&cfg.exchange, "exchange", "binance", "Exchange, only Binance is supported")
	flag.StringVar(&cfg.marketType, "market-type", "usdm", "spot, usdm, or coinm")
	flag.StringVar(&cfg.timeframes, "timeframes", "1w,1d,4h,1h", "Comma-separated timeframe list")
	flag.IntVar(&cfg.limit, "limit", 0, "Optional fixed limit for all timeframes")
	flag.Int64Var(&cfg.sinceTS, "since-ts", 0, "Optional inclusive start open timestamp in ms")
	flag.Parse()

	if strings.TrimSpace(cfg.symbol) == "" {
		return cfg, errors.New("--symbol is required")
	}
	cfg.marketType = strings.ToLower(strings.TrimSpace(cfg.marketType))
	switch cfg.marketType {
	case "spot", "usdm", "coinm":
	default:
		return cfg, fmt.Errorf("unsupported market-type: %s", cfg.marketType)
	}

	cfg.exchange = strings.ToLower(strings.TrimSpace(cfg.exchange))
	if cfg.limit < 0 {
		return cfg, errors.New("--limit cannot be negative")
	}
	if cfg.sinceTS < 0 {
		return cfg, errors.New("--since-ts cannot be negative")
	}
	return cfg, nil
}

func resolveFetchConfig(exchangeID, marketType, rawSymbol string) (fetchConfig, error) {
	switch marketType {
	case "spot":
		if exchangeID != "binance" {
			return fetchConfig{}, fmt.Errorf("only Binance is supported; unsupported exchange: %s", exchangeID)
		}
		return fetchConfig{
			baseURL:          spotBaseURL,
			klinesPath:       "/api/v3/klines",
			exchangeInfoPath: "/api/v3/exchangeInfo",
			exchangeID:       "binance",
			manifestSymbol:   resolveManifestSymbol(rawSymbol, marketType),
			apiSymbol:        resolveAPISymbol(rawSymbol, marketType),
		}, nil
	case "usdm":
		if exchangeID != "binance" && exchangeID != "binanceusdm" {
			return fetchConfig{}, fmt.Errorf("only Binance USD-M is supported; unsupported exchange: %s", exchangeID)
		}
		return fetchConfig{
			baseURL:          usdmBaseURL,
			klinesPath:       "/fapi/v1/klines",
			exchangeInfoPath: "/fapi/v1/exchangeInfo",
			exchangeID:       "binanceusdm",
			manifestSymbol:   resolveManifestSymbol(rawSymbol, marketType),
			apiSymbol:        resolveAPISymbol(rawSymbol, marketType),
		}, nil
	case "coinm":
		if exchangeID != "binance" && exchangeID != "binancecoinm" {
			return fetchConfig{}, fmt.Errorf("only Binance COIN-M is supported; unsupported exchange: %s", exchangeID)
		}
		return fetchConfig{
			baseURL:          coinmBaseURL,
			klinesPath:       "/dapi/v1/klines",
			exchangeInfoPath: "/dapi/v1/exchangeInfo",
			exchangeID:       "binancecoinm",
			manifestSymbol:   resolveManifestSymbol(rawSymbol, marketType),
			apiSymbol:        resolveAPISymbol(rawSymbol, marketType),
		}, nil
	}
	return fetchConfig{}, fmt.Errorf("unsupported market-type: %s", marketType)
}

func resolveManifestSymbol(rawSymbol, marketType string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(rawSymbol))
	if strings.Contains(trimmed, ":") || !strings.Contains(trimmed, "/") {
		return trimmed
	}

	parts := strings.SplitN(trimmed, "/", 2)
	base := parts[0]
	quote := parts[1]
	switch marketType {
	case "usdm":
		return base + "/" + quote + ":" + quote
	case "coinm":
		return base + "/" + quote + ":" + base
	default:
		return trimmed
	}
}

func resolveAPISymbol(rawSymbol, marketType string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(rawSymbol))
	if marketType == "coinm" {
		if strings.HasSuffix(trimmed, "_PERP") {
			return trimmed
		}
	}

	baseQuote := trimmed
	if strings.Contains(baseQuote, ":") {
		baseQuote = strings.SplitN(baseQuote, ":", 2)[0]
	}
	if strings.Contains(baseQuote, "/") {
		parts := strings.SplitN(baseQuote, "/", 2)
		base := parts[0]
		quote := parts[1]
		if marketType == "coinm" {
			return base + quote + "_PERP"
		}
		return base + quote
	}

	if marketType == "coinm" && !strings.HasSuffix(baseQuote, "_PERP") {
		return baseQuote + "_PERP"
	}
	return baseQuote
}

func orderedTimeframes(raw string) []string {
	seen := map[string]struct{}{}
	for _, part := range strings.Split(raw, ",") {
		tf := strings.TrimSpace(part)
		if tf == "" {
			continue
		}
		if _, dup := seen[tf]; dup {
			continue
		}
		seen[tf] = struct{}{}
	}
	ordered := make([]string, 0, len(seen))
	for _, tf := range timeframeOrder {
		if _, ok := seen[tf]; ok {
			ordered = append(ordered, tf)
			delete(seen, tf)
		}
	}
	for tf := range seen {
		ordered = append(ordered, tf)
	}
	return ordered
}

func fetchAllTimeframes(client httpClient, cfg fetchConfig, timeframes []string, limitOverride int, sinceTS int64) (map[string]timeframeResult, error) {
	results := make(map[string]timeframeResult, len(timeframes))
	outcomes := make(chan timeframeResult, len(timeframes))

	for _, timeframe := range timeframes {
		limit := limitOverride
		if limit == 0 {
			limit = defaultLimits[timeframe]
			if limit == 0 {
				limit = 300
			}
		}

		go func(timeframe string, limit int) {
			candles, err := fetchKlines(client, cfg, timeframe, limit, sinceTS)
			outcomes <- timeframeResult{
				timeframe: timeframe,
				candles:   candles,
				limit:     limit,
				err:       err,
			}
		}(timeframe, limit)
	}

	for range len(timeframes) {
		result := <-outcomes
		if result.err != nil {
			return nil, result.err
		}
		results[result.timeframe] = result
	}
	return results, nil
}

func fetchKlines(client httpClient, cfg fetchConfig, timeframe string, limit int, sinceTS int64) ([]candle, error) {
	query := url.Values{}
	query.Set("symbol", cfg.apiSymbol)
	query.Set("interval", timeframe)
	query.Set("limit", fmt.Sprintf("%d", limit))
	if sinceTS > 0 {
		query.Set("startTime", fmt.Sprintf("%d", sinceTS))
	}

	body, err := client.get(cfg.baseURL + cfg.klinesPath + "?" + query.Encode())
	if err != nil {
		return nil, err
	}

	var payload [][]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("%s %s returned no OHLCV data", cfg.manifestSymbol, timeframe)
	}

	rows := make([]candle, 0, len(payload))
	for _, item := range payload {
		if len(item) < 6 {
			return nil, fmt.Errorf("%s %s returned incomplete candle", cfg.manifestSymbol, timeframe)
		}
		openTime, err := toInt64(item[0])
		if err != nil {
			return nil, err
		}
		rows = append(rows, candle{
			Date:      time.UnixMilli(openTime).UTC().Format(time.RFC3339),
			Timestamp: openTime,
			Open:      fmt.Sprint(item[1]),
			High:      fmt.Sprint(item[2]),
			Low:       fmt.Sprint(item[3]),
			Close:     fmt.Sprint(item[4]),
			Volume:    fmt.Sprint(item[5]),
		})
	}
	return rows, nil
}

func ensureSymbolSupported(client httpClient, cfg fetchConfig) error {
	query := url.Values{}
	query.Set("symbol", cfg.apiSymbol)
	body, err := client.get(cfg.baseURL + cfg.exchangeInfoPath + "?" + query.Encode())
	if err != nil {
		return err
	}

	var payload struct {
		Code    any    `json:"code"`
		Msg     string `json:"msg"`
		Symbols []struct {
			Symbol string `json:"symbol"`
			Status string `json:"status"`
		} `json:"symbols"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if payload.Code != nil {
		return fmt.Errorf("%s does not support symbol: %s", cfg.exchangeID, cfg.manifestSymbol)
	}
	if len(payload.Symbols) == 0 || payload.Symbols[0].Symbol != cfg.apiSymbol {
		return fmt.Errorf("%s does not support symbol: %s", cfg.exchangeID, cfg.manifestSymbol)
	}
	return nil
}

func (c httpClient) get(target string) ([]byte, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return body, nil
	}
	return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func toInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), nil
	case int64:
		return typed, nil
	case int:
		return int64(typed), nil
	default:
		return 0, fmt.Errorf("cannot parse timestamp: %v", value)
	}
}
