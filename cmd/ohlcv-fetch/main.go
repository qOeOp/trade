package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
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
	outputDir  string
	limit      int
	sinceTS    int64
}

type marketSpec struct {
	baseURL          string
	klinesPath       string
	exchangeInfoPath string
	exchangeID       string
}

type symbolSpec struct {
	manifest string
	api      string
}

type fetchConfig struct {
	market marketSpec
	symbol symbolSpec
}

type fetchResponse struct {
	Symbol            string                            `json:"symbol"`
	RequestedSymbol   string                            `json:"requested_symbol"`
	Exchange          string                            `json:"exchange"`
	RequestedExchange string                            `json:"requested_exchange"`
	MarketType        string                            `json:"market_type"`
	GeneratedAt       string                            `json:"generated_at"`
	OutputDir         string                            `json:"output_dir"`
	ManifestPath      string                            `json:"manifest_path"`
	Columns           []string                          `json:"columns"`
	DedupeKey         string                            `json:"dedupe_key"`
	RequestedSinceTS  *int64                            `json:"requested_since_ts,omitempty"`
	Timeframes        map[string]timeframeResponseEntry `json:"timeframes"`
}

type timeframeResponseEntry struct {
	File        string `json:"file"`
	Limit       int    `json:"limit"`
	FirstOpenTS int64  `json:"first_open_ts"`
	LastOpenTS  int64  `json:"last_open_ts"`
	Rows        int    `json:"rows"`
	AppendOnly  bool   `json:"append_only"`
	AscendingTS bool   `json:"ascending_ts"`
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

	outputDir, err := resolveOutputDir(cfg.outputDir)
	if err != nil {
		return err
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
		Symbol:            fetchCfg.symbol.manifest,
		RequestedSymbol:   cfg.symbol,
		Exchange:          fetchCfg.market.exchangeID,
		RequestedExchange: cfg.exchange,
		MarketType:        cfg.marketType,
		GeneratedAt:       time.Now().In(loc).Format(time.RFC3339Nano),
		OutputDir:         outputDir,
		Columns:           []string{"date", "timestamp", "open", "high", "low", "close", "volume"},
		DedupeKey:         "timestamp",
		Timeframes:        map[string]timeframeResponseEntry{},
	}
	if cfg.sinceTS > 0 {
		response.RequestedSinceTS = &cfg.sinceTS
	}

	for _, timeframe := range timeframes {
		result := results[timeframe]
		fileName := timeframe + ".csv"
		entry := timeframeResponseEntry{
			File:        fileName,
			Limit:       result.limit,
			Rows:        len(result.candles),
			AppendOnly:  true,
			AscendingTS: true,
		}
		if len(result.candles) > 0 {
			entry.FirstOpenTS = result.candles[0].Timestamp
			entry.LastOpenTS = result.candles[len(result.candles)-1].Timestamp
		}
		if err := writeCandlesCSV(filepath.Join(outputDir, fileName), result.candles); err != nil {
			return err
		}
		response.Timeframes[timeframe] = entry
	}

	manifestPath := filepath.Join(outputDir, "manifest.json")
	response.ManifestPath = manifestPath
	if err := writeManifest(manifestPath, response); err != nil {
		return err
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
	flag.StringVar(&cfg.outputDir, "output-dir", "", "Optional directory for manifest.json and CSV files")
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

func resolveOutputDir(raw string) (string, error) {
	trimmed := strings.TrimSpace(os.ExpandEnv(raw))
	if trimmed == "" {
		dir, err := os.MkdirTemp("", "ohlcv-fetch-")
		if err != nil {
			return "", err
		}
		return dir, nil
	}

	resolved, err := filepath.Abs(trimmed)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(resolved, 0o755); err != nil {
		return "", err
	}
	return resolved, nil
}

func writeCandlesCSV(path string, candles []candle) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	if err := writer.Write([]string{"date", "timestamp", "open", "high", "low", "close", "volume"}); err != nil {
		return err
	}
	for _, candle := range candles {
		row := []string{
			candle.Date,
			fmt.Sprintf("%d", candle.Timestamp),
			candle.Open,
			candle.High,
			candle.Low,
			candle.Close,
			candle.Volume,
		}
		if err := writer.Write(row); err != nil {
			return err
		}
	}
	writer.Flush()
	return writer.Error()
}

func writeManifest(path string, payload fetchResponse) error {
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

func resolveFetchConfig(exchangeID, marketType, rawSymbol string) (fetchConfig, error) {
	market, err := resolveMarketSpec(exchangeID, marketType)
	if err != nil {
		return fetchConfig{}, err
	}
	symbol, err := resolveSymbolSpec(rawSymbol, marketType)
	if err != nil {
		return fetchConfig{}, err
	}
	return fetchConfig{
		market: market,
		symbol: symbol,
	}, nil
}

func resolveMarketSpec(exchangeID, marketType string) (marketSpec, error) {
	switch marketType {
	case "spot":
		if exchangeID != "binance" {
			return marketSpec{}, fmt.Errorf("only Binance is supported; unsupported exchange: %s", exchangeID)
		}
		return marketSpec{
			baseURL:          spotBaseURL,
			klinesPath:       "/api/v3/klines",
			exchangeInfoPath: "/api/v3/exchangeInfo",
			exchangeID:       "binance",
		}, nil
	case "usdm":
		if exchangeID != "binance" && exchangeID != "binanceusdm" {
			return marketSpec{}, fmt.Errorf("only Binance USD-M is supported; unsupported exchange: %s", exchangeID)
		}
		return marketSpec{
			baseURL:          usdmBaseURL,
			klinesPath:       "/fapi/v1/klines",
			exchangeInfoPath: "/fapi/v1/exchangeInfo",
			exchangeID:       "binanceusdm",
		}, nil
	case "coinm":
		if exchangeID != "binance" && exchangeID != "binancecoinm" {
			return marketSpec{}, fmt.Errorf("only Binance COIN-M is supported; unsupported exchange: %s", exchangeID)
		}
		return marketSpec{
			baseURL:          coinmBaseURL,
			klinesPath:       "/dapi/v1/klines",
			exchangeInfoPath: "/dapi/v1/exchangeInfo",
			exchangeID:       "binancecoinm",
		}, nil
	}
	return marketSpec{}, fmt.Errorf("unsupported market-type: %s", marketType)
}

func resolveSymbolSpec(rawSymbol, marketType string) (symbolSpec, error) {
	trimmed := strings.ToUpper(strings.TrimSpace(rawSymbol))
	if trimmed == "" {
		return symbolSpec{}, errors.New("symbol cannot be empty")
	}
	if marketType == "coinm" {
		return resolveCoinMSymbolSpec(trimmed), nil
	}
	return resolveLinearSymbolSpec(trimmed, marketType), nil
}

func resolveLinearSymbolSpec(trimmed, marketType string) symbolSpec {
	if strings.Contains(trimmed, ":") || !strings.Contains(trimmed, "/") {
		return symbolSpec{
			manifest: trimmed,
			api:      resolveAPISymbol(trimmed, marketType),
		}
	}
	parts := strings.SplitN(trimmed, "/", 2)
	base := parts[0]
	quote := parts[1]
	switch marketType {
	case "usdm":
		return symbolSpec{
			manifest: base + "/" + quote + ":" + quote,
			api:      base + quote,
		}
	default:
		return symbolSpec{
			manifest: trimmed,
			api:      base + quote,
		}
	}
}

func resolveCoinMSymbolSpec(trimmed string) symbolSpec {
	if strings.Contains(trimmed, ":") || !strings.Contains(trimmed, "/") {
		return symbolSpec{
			manifest: trimmed,
			api:      resolveAPISymbol(trimmed, "coinm"),
		}
	}
	parts := strings.SplitN(trimmed, "/", 2)
	base := parts[0]
	quote := parts[1]
	return symbolSpec{
		manifest: base + "/" + quote + ":" + base,
		api:      base + quote + "_PERP",
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
	query.Set("symbol", cfg.symbol.api)
	query.Set("interval", timeframe)
	query.Set("limit", fmt.Sprintf("%d", limit))
	if sinceTS > 0 {
		query.Set("startTime", fmt.Sprintf("%d", sinceTS))
	}

	body, err := client.get(cfg.market.baseURL + cfg.market.klinesPath + "?" + query.Encode())
	if err != nil {
		return nil, err
	}

	var payload [][]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("%s %s returned no OHLCV data", cfg.symbol.manifest, timeframe)
	}

	rows := make([]candle, 0, len(payload))
	for _, item := range payload {
		if len(item) < 6 {
			return nil, fmt.Errorf("%s %s returned incomplete candle", cfg.symbol.manifest, timeframe)
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
	body, err := client.get(cfg.market.baseURL + cfg.market.exchangeInfoPath)
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
		return fmt.Errorf("%s does not support symbol: %s", cfg.market.exchangeID, cfg.symbol.manifest)
	}
	for _, symbol := range payload.Symbols {
		if symbol.Symbol != cfg.symbol.api {
			continue
		}
		if symbol.Status != "" && symbol.Status != "TRADING" {
			return fmt.Errorf("%s symbol not tradable: %s (%s)", cfg.market.exchangeID, cfg.symbol.manifest, symbol.Status)
		}
		return nil
	}
	return fmt.Errorf("%s does not support symbol: %s", cfg.market.exchangeID, cfg.symbol.manifest)
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
