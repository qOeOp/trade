package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	spotBaseURL    = "https://api.binance.com"
	futuresBaseURL = "https://fapi.binance.com"
)

var (
	spotProtectiveTypes = map[string]struct{}{
		"STOP_LOSS":         {},
		"STOP_LOSS_LIMIT":   {},
		"TAKE_PROFIT":       {},
		"TAKE_PROFIT_LIMIT": {},
	}
	futuresProtectiveTypes = map[string]struct{}{
		"STOP":                 {},
		"STOP_MARKET":          {},
		"TAKE_PROFIT":          {},
		"TAKE_PROFIT_MARKET":   {},
		"TRAILING_STOP_MARKET": {},
	}
)

type config struct {
	symbol         string
	spotOnly       bool
	futuresOnly    bool
	checkEnv       bool
	includeHistory bool
	historyLimit   int
	timeout        time.Duration
	recvWindow     int64
}

type snapshot struct {
	GeneratedAt  string            `json:"generatedAt"`
	SymbolFilter *string           `json:"symbolFilter"`
	Spot         *spotSnapshot     `json:"spot"`
	Futures      *futuresSnapshot  `json:"futures"`
	Errors       map[string]string `json:"errors"`
}

type spotSnapshot struct {
	Permissions  []string         `json:"permissions"`
	Balances     []map[string]any `json:"balances"`
	OpenOrders   *orderBuckets    `json:"openOrders"`
	OrderHistory *orderBuckets    `json:"orderHistory,omitempty"`
}

type futuresSnapshot struct {
	Account      map[string]any   `json:"account"`
	Balances     []map[string]any `json:"balances"`
	Positions    []map[string]any `json:"positions"`
	OpenOrders   *orderBuckets    `json:"openOrders"`
	OrderHistory *orderBuckets    `json:"orderHistory,omitempty"`
}

type orderBuckets struct {
	Regular    []map[string]any `json:"regular"`
	Protective []map[string]any `json:"protective"`
}

type binanceError struct {
	message string
	rawBody string
}

func (e *binanceError) Error() string { return e.message }

type binanceClient struct {
	apiKey     string
	apiSecret  []byte
	httpClient *http.Client
	recvWindow int64
	times      map[string]serverTimeState
	mu         sync.Mutex
}

type fetchOutcome struct {
	key   string
	value any
	err   error
}

type serverTimeState struct {
	offset int64
	set    bool
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

	ok, missing := checkEnv()
	if cfg.checkEnv {
		out, _ := json.MarshalIndent(map[string]any{"ok": true, "data": map[string]any{
			"ok":      ok,
			"missing": missing,
		}}, "", "  ")
		os.Stdout.Write(append(out, '\n'))
		if !ok {
			os.Exit(1)
		}
		return nil
	}

	if !ok {
		return fmt.Errorf("missing environment variables: %s", strings.Join(missing, ", "))
	}

	client := newBinanceClient(
		os.Getenv("BINANCE_API_KEY"),
		os.Getenv("BINANCE_API_SECRET"),
		cfg.timeout,
		cfg.recvWindow,
	)

	result := buildSnapshot(cfg, client)
	out, _ := json.MarshalIndent(map[string]any{"ok": true, "data": result}, "", "  ")
	os.Stdout.Write(append(out, '\n'))
	return nil
}

func parseFlags() (config, error) {
	var cfg config
	var timeout float64

	flag.StringVar(&cfg.symbol, "symbol", "", "Optional symbol filter, e.g. BTCUSDT")
	flag.BoolVar(&cfg.spotOnly, "spot-only", false, "Only query spot account data")
	flag.BoolVar(&cfg.futuresOnly, "futures-only", false, "Only query USD-M futures data")
	flag.BoolVar(&cfg.checkEnv, "check-env", false, "Only verify required env vars")
	flag.BoolVar(&cfg.includeHistory, "include-history", false, "Include historical orders for the selected symbol")
	flag.IntVar(&cfg.historyLimit, "history-limit", 20, "Historical order limit per endpoint when --include-history is used")
	flag.Float64Var(&timeout, "timeout", 10.0, "HTTP timeout in seconds")
	flag.Int64Var(&cfg.recvWindow, "recv-window", 60000, "Binance recvWindow in ms")
	flag.Parse()

	if cfg.spotOnly && cfg.futuresOnly {
		return cfg, errors.New("--spot-only and --futures-only cannot be used together")
	}
	if cfg.includeHistory && cfg.symbol == "" {
		return cfg, errors.New("--include-history requires --symbol because Binance historical order endpoints are symbol-scoped")
	}
	if cfg.historyLimit <= 0 {
		return cfg, errors.New("--history-limit must be greater than 0")
	}
	if cfg.symbol != "" {
		cfg.symbol = strings.ToUpper(cfg.symbol)
	}
	cfg.timeout = time.Duration(timeout * float64(time.Second))
	return cfg, nil
}

func newBinanceClient(apiKey, apiSecret string, timeout time.Duration, recvWindow int64) *binanceClient {
	return &binanceClient{
		apiKey:     apiKey,
		apiSecret:  []byte(apiSecret),
		httpClient: &http.Client{Timeout: timeout},
		recvWindow: recvWindow,
		times:      map[string]serverTimeState{},
	}
}

func checkEnv() (bool, []string) {
	required := []string{"BINANCE_API_KEY", "BINANCE_API_SECRET"}
	missing := make([]string, 0, len(required))
	for _, name := range required {
		if os.Getenv(name) == "" {
			missing = append(missing, name)
		}
	}
	return len(missing) == 0, missing
}

func buildSnapshot(cfg config, client *binanceClient) snapshot {
	var symbolFilter *string
	if cfg.symbol != "" {
		symbolFilter = &cfg.symbol
	}

	result := snapshot{
		GeneratedAt:  time.Now().UTC().Truncate(time.Second).Format(time.RFC3339),
		SymbolFilter: symbolFilter,
		Errors:       map[string]string{},
	}

	params := map[string]string{}
	if cfg.symbol != "" {
		params["symbol"] = cfg.symbol
	}

	if !cfg.futuresOnly {
		spot := buildSpotSnapshot(cfg, client, params, result.Errors)
		result.Spot = &spot
	}
	if !cfg.spotOnly {
		futures := buildFuturesSnapshot(cfg, client, params, result.Errors)
		result.Futures = &futures
	}

	return result
}

func buildSpotSnapshot(cfg config, client *binanceClient, params map[string]string, errorsMap map[string]string) spotSnapshot {
	outcomeCount := 2
	if cfg.includeHistory {
		outcomeCount++
	}
	outcomes := make(chan fetchOutcome, outcomeCount)

	go func() {
		value, err := client.signedGetWithRetry(spotBaseURL, "/api/v3/account", nil, true)
		outcomes <- fetchOutcome{key: "spot.account", value: value, err: err}
	}()

	go func() {
		value, err := client.signedGetWithRetry(spotBaseURL, "/api/v3/openOrders", params, true)
		outcomes <- fetchOutcome{key: "spot.openOrders", value: value, err: err}
	}()

	if cfg.includeHistory {
		go func() {
			historyParams := copyParamsWithLimit(params, cfg.historyLimit)
			value, err := client.signedGetWithRetry(spotBaseURL, "/api/v3/allOrders", historyParams, true)
			outcomes <- fetchOutcome{key: "spot.allOrders", value: value, err: err}
		}()
	}

	var accountValue any
	var ordersValue any
	var historyValue any
	for range outcomeCount {
		outcome := <-outcomes
		if outcome.err != nil {
			errorsMap[outcome.key] = outcome.err.Error()
			continue
		}
		delete(errorsMap, outcome.key)
		switch outcome.key {
		case "spot.account":
			accountValue = outcome.value
		case "spot.openOrders":
			ordersValue = outcome.value
		case "spot.allOrders":
			historyValue = outcome.value
		}
	}

	permissions := []string{}
	balances := []map[string]any{}

	if account, ok := asMap(accountValue); ok {
		for _, permission := range asStringSlice(account["permissions"]) {
			permissions = append(permissions, permission)
		}
		if rawBalances, ok := asMapSlice(account["balances"]); ok {
			for _, balance := range rawBalances {
				if keepSpotBalance(balance) {
					balances = append(balances, normalizeSpotBalance(balance))
				}
			}
		}
	}

	var buckets *orderBuckets
	if orders, ok := asMapSlice(ordersValue); ok {
		split := splitOrders(orders, isSpotProtective, normalizeStandardOrder("openOrders", "standard"))
		buckets = &split
	}

	var historyBuckets *orderBuckets
	if historyOrders, ok := asMapSlice(historyValue); ok {
		split := splitOrders(historyOrders, isSpotProtective, normalizeStandardOrder("allOrders", "standard"))
		historyBuckets = &split
	}

	return spotSnapshot{
		Permissions:  permissions,
		Balances:     balances,
		OpenOrders:   buckets,
		OrderHistory: historyBuckets,
	}
}

func buildFuturesSnapshot(cfg config, client *binanceClient, params map[string]string, errorsMap map[string]string) futuresSnapshot {
	outcomeCount := 4
	if cfg.includeHistory {
		outcomeCount += 2
	}
	outcomes := make(chan fetchOutcome, outcomeCount)

	go func() {
		value, err := client.signedGetWithRetry(futuresBaseURL, "/fapi/v3/account", params, true)
		outcomes <- fetchOutcome{key: "futures.account", value: value, err: err}
	}()

	go func() {
		value, err := client.signedGetWithRetry(futuresBaseURL, "/fapi/v3/positionRisk", params, true)
		outcomes <- fetchOutcome{key: "futures.positionRisk", value: value, err: err}
	}()

	go func() {
		value, err := client.signedGetWithRetry(futuresBaseURL, "/fapi/v1/openOrders", params, true)
		outcomes <- fetchOutcome{key: "futures.openOrders", value: value, err: err}
	}()

	go func() {
		value, err := client.signedGetWithRetry(futuresBaseURL, "/fapi/v1/openAlgoOrders", params, true)
		outcomes <- fetchOutcome{key: "futures.openAlgoOrders", value: value, err: err}
	}()

	if cfg.includeHistory {
		go func() {
			historyParams := copyParamsWithLimit(params, cfg.historyLimit)
			value, err := client.signedGetWithRetry(futuresBaseURL, "/fapi/v1/allOrders", historyParams, true)
			outcomes <- fetchOutcome{key: "futures.allOrders", value: value, err: err}
		}()

		go func() {
			historyParams := copyParamsWithLimit(params, cfg.historyLimit)
			value, err := client.signedGetWithRetry(futuresBaseURL, "/fapi/v1/allAlgoOrders", historyParams, true)
			outcomes <- fetchOutcome{key: "futures.allAlgoOrders", value: value, err: err}
		}()
	}

	var accountValue any
	var positionsValue any
	var ordersValue any
	var algoOrdersValue any
	var historyOrdersValue any
	var historyAlgoOrdersValue any
	for range outcomeCount {
		outcome := <-outcomes
		if outcome.err != nil {
			errorsMap[outcome.key] = outcome.err.Error()
			continue
		}
		delete(errorsMap, outcome.key)
		switch outcome.key {
		case "futures.account":
			accountValue = outcome.value
		case "futures.positionRisk":
			positionsValue = outcome.value
		case "futures.openOrders":
			ordersValue = outcome.value
		case "futures.openAlgoOrders":
			algoOrdersValue = outcome.value
		case "futures.allOrders":
			historyOrdersValue = outcome.value
		case "futures.allAlgoOrders":
			historyAlgoOrdersValue = outcome.value
		}
	}

	accountFlags := map[string]any{}
	balances := []map[string]any{}
	if account, ok := asMap(accountValue); ok {
		if rawAssets, ok := asMapSlice(account["assets"]); ok {
			for _, asset := range rawAssets {
				if keepFuturesAsset(asset) {
					balances = append(balances, normalizeFuturesAsset(asset))
				}
			}
		}
		accountFlags = map[string]any{
			"feeTier":               account["feeTier"],
			"canTrade":              account["canTrade"],
			"canDeposit":            account["canDeposit"],
			"canWithdraw":           account["canWithdraw"],
			"multiAssetsMargin":     account["multiAssetsMargin"],
			"totalWalletBalance":    account["totalWalletBalance"],
			"totalUnrealizedProfit": account["totalUnrealizedProfit"],
			"totalMarginBalance":    account["totalMarginBalance"],
			"availableBalance":      account["availableBalance"],
		}
	}

	var positions []map[string]any
	if rawPositions, ok := asMapSlice(positionsValue); ok {
		positions = []map[string]any{}
		for _, position := range rawPositions {
			if keepPosition(position) {
				positions = append(positions, normalizePosition(position))
			}
		}
	}

	var buckets *orderBuckets
	if orders, ok := asMapSlice(ordersValue); ok {
		split := splitOrders(orders, isFuturesProtective, normalizeStandardOrder("openOrders", "standard"))
		buckets = &split
	}
	if algoOrders, ok := asMapSlice(algoOrdersValue); ok {
		buckets = appendProtectiveOrders(buckets, algoOrders, normalizeFuturesAlgoOrder("openAlgoOrders", "algo"))
	}

	var historyBuckets *orderBuckets
	if historyOrders, ok := asMapSlice(historyOrdersValue); ok {
		split := splitOrders(historyOrders, isFuturesProtective, normalizeStandardOrder("allOrders", "standard"))
		historyBuckets = &split
	}
	if historyAlgoOrders, ok := asMapSlice(historyAlgoOrdersValue); ok {
		historyBuckets = appendProtectiveOrders(historyBuckets, historyAlgoOrders, normalizeFuturesAlgoOrder("allAlgoOrders", "algo"))
	}

	return futuresSnapshot{
		Account:      accountFlags,
		Balances:     balances,
		Positions:    positions,
		OpenOrders:   buckets,
		OrderHistory: historyBuckets,
	}
}

func (c *binanceClient) signedGetWithRetry(baseURL, path string, params map[string]string, retryTimestamp bool) (any, error) {
	queryParams := url.Values{}
	for key, value := range params {
		queryParams.Set(key, value)
	}
	queryParams.Set("timestamp", fmt.Sprintf("%d", time.Now().UnixMilli()+c.getServerTimeOffset(baseURL)))
	queryParams.Set("recvWindow", fmt.Sprintf("%d", c.recvWindow))

	query := queryParams.Encode()
	signature := signQuery(c.apiSecret, query)
	fullURL := fmt.Sprintf("%s%s?%s&signature=%s", baseURL, path, query, signature)

	payload, err := c.openJSON(fullURL, path)
	if err == nil {
		return payload, nil
	}

	var binErr *binanceError
	if errors.As(err, &binErr) && retryTimestamp && binErr.rawBody != "" {
		if strings.Contains(strings.ReplaceAll(binErr.rawBody, " ", ""), "\"code\":-1021") {
			c.clearServerTimeOffset(baseURL)
			return c.signedGetWithRetry(baseURL, path, params, false)
		}
	}

	return nil, err
}

func (c *binanceClient) getServerTimeOffset(baseURL string) int64 {
	c.mu.Lock()
	if state, ok := c.times[baseURL]; ok && state.set {
		c.mu.Unlock()
		return state.offset
	}
	c.mu.Unlock()

	timePath := "/api/v3/time"
	if baseURL == futuresBaseURL {
		timePath = "/fapi/v1/time"
	}
	payload, err := c.openJSON(baseURL+timePath, timePath)
	if err != nil {
		return 0
	}
	value, ok := asMap(payload)
	if !ok {
		return 0
	}
	serverTime := int64(toFloat(value["serverTime"]))
	if serverTime == 0 {
		return 0
	}
	offset := serverTime - time.Now().UnixMilli()

	c.mu.Lock()
	c.times[baseURL] = serverTimeState{offset: offset, set: true}
	c.mu.Unlock()
	return offset
}

func (c *binanceClient) clearServerTimeOffset(baseURL string) {
	c.mu.Lock()
	delete(c.times, baseURL)
	c.mu.Unlock()
}

func (c *binanceClient) openJSON(fullURL, path string) (any, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, err
	}
	if c.apiKey != "" {
		req.Header.Set("X-MBX-APIKEY", c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, &binanceError{message: fmt.Sprintf("%s failed: %s", path, err.Error())}
	}

	bodyBytes, readErr := io.ReadAll(resp.Body)
	resp.Body.Close()
	if readErr != nil {
		return nil, &binanceError{message: fmt.Sprintf("%s failed: %s", path, readErr.Error())}
	}

	body := string(bodyBytes)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := body
		var apiPayload map[string]any
		if json.Unmarshal(bodyBytes, &apiPayload) == nil {
			code, hasCode := apiPayload["code"]
			msg, hasMsg := apiPayload["msg"]
			if hasCode || hasMsg {
				message = fmt.Sprintf("code=%v msg=%v", code, msg)
			}
		}
		return nil, &binanceError{
			message: fmt.Sprintf("%s failed with HTTP %d: %s", path, resp.StatusCode, message),
			rawBody: body,
		}
	}

	var payload any
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		return nil, &binanceError{message: fmt.Sprintf("%s failed: %s", path, err.Error())}
	}
	return payload, nil
}

func signQuery(secret []byte, query string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(query))
	return hex.EncodeToString(mac.Sum(nil))
}

func keepSpotBalance(balance map[string]any) bool {
	return toFloat(balance["free"])+toFloat(balance["locked"]) != 0
}

func normalizeSpotBalance(balance map[string]any) map[string]any {
	free := toFloat(balance["free"])
	locked := toFloat(balance["locked"])
	return map[string]any{
		"asset":  balance["asset"],
		"free":   balance["free"],
		"locked": balance["locked"],
		"total":  fmt.Sprintf("%.8f", free+locked),
	}
}

func keepFuturesAsset(asset map[string]any) bool {
	fields := []any{
		asset["walletBalance"],
		asset["availableBalance"],
		asset["unrealizedProfit"],
		asset["marginBalance"],
	}
	for _, field := range fields {
		if toFloat(field) != 0 {
			return true
		}
	}
	return false
}

func normalizeFuturesAsset(asset map[string]any) map[string]any {
	return map[string]any{
		"asset":            asset["asset"],
		"walletBalance":    asset["walletBalance"],
		"availableBalance": asset["availableBalance"],
		"marginBalance":    asset["marginBalance"],
		"unrealizedProfit": asset["unrealizedProfit"],
	}
}

func keepPosition(position map[string]any) bool {
	return toFloat(position["positionAmt"]) != 0
}

func normalizePosition(position map[string]any) map[string]any {
	return map[string]any{
		"symbol":           position["symbol"],
		"positionSide":     position["positionSide"],
		"positionAmt":      position["positionAmt"],
		"entryPrice":       position["entryPrice"],
		"breakEvenPrice":   position["breakEvenPrice"],
		"markPrice":        position["markPrice"],
		"unRealizedProfit": position["unRealizedProfit"],
		"liquidationPrice": position["liquidationPrice"],
		"leverage":         position["leverage"],
		"marginType":       position["marginType"],
		"notional":         position["notional"],
	}
}

func isSpotProtective(order map[string]any) bool {
	orderType := strings.ToUpper(fmt.Sprint(order["type"]))
	orderListID := order["orderListId"]
	if _, ok := spotProtectiveTypes[orderType]; ok {
		return true
	}
	return orderListID != nil && fmt.Sprint(orderListID) != "-1"
}

func isFuturesProtective(order map[string]any) bool {
	orderType := strings.ToUpper(fmt.Sprint(order["type"]))
	if _, ok := futuresProtectiveTypes[orderType]; ok {
		return true
	}
	closePosition := strings.ToLower(fmt.Sprint(order["closePosition"]))
	return closePosition == "true"
}

func normalizeStandardOrder(source, sourceType string) func(map[string]any) map[string]any {
	return func(order map[string]any) map[string]any {
		normalized := map[string]any{
			"symbol":      order["symbol"],
			"side":        order["side"],
			"type":        order["type"],
			"status":      order["status"],
			"origQty":     order["origQty"],
			"price":       order["price"],
			"stopPrice":   order["stopPrice"],
			"timeInForce": order["timeInForce"],
			"orderId":     order["orderId"],
			"source":      source,
			"sourceType":  sourceType,
		}
		if _, ok := order["positionSide"]; ok {
			normalized["positionSide"] = order["positionSide"]
		}
		if _, ok := order["closePosition"]; ok {
			normalized["closePosition"] = order["closePosition"]
		}
		if _, ok := order["activatePrice"]; ok {
			normalized["activatePrice"] = order["activatePrice"]
		}
		if _, ok := order["priceRate"]; ok {
			normalized["priceRate"] = order["priceRate"]
		}
		return normalized
	}
}

func normalizeFuturesAlgoOrder(source, sourceType string) func(map[string]any) map[string]any {
	return func(order map[string]any) map[string]any {
		normalized := map[string]any{
			"symbol":      order["symbol"],
			"side":        order["side"],
			"type":        order["orderType"],
			"status":      order["algoStatus"],
			"origQty":     firstNonNil(order["quantity"], order["origQty"]),
			"price":       order["price"],
			"stopPrice":   firstNonNil(order["triggerPrice"], order["stopPrice"]),
			"timeInForce": order["timeInForce"],
			"algoId":      order["algoId"],
			"source":      source,
			"sourceType":  sourceType,
		}
		if _, ok := order["clientAlgoId"]; ok {
			normalized["clientAlgoId"] = order["clientAlgoId"]
		}
		if _, ok := order["positionSide"]; ok {
			normalized["positionSide"] = order["positionSide"]
		}
		if _, ok := order["closePosition"]; ok {
			normalized["closePosition"] = order["closePosition"]
		}
		if _, ok := order["reduceOnly"]; ok {
			normalized["reduceOnly"] = order["reduceOnly"]
		}
		if _, ok := order["workingType"]; ok {
			normalized["workingType"] = order["workingType"]
		}
		if _, ok := order["priceProtect"]; ok {
			normalized["priceProtect"] = order["priceProtect"]
		}
		if _, ok := order["triggerTime"]; ok {
			normalized["triggerTime"] = order["triggerTime"]
		}
		if _, ok := order["actualOrderId"]; ok && fmt.Sprint(order["actualOrderId"]) != "" {
			normalized["actualOrderId"] = order["actualOrderId"]
		}
		return normalized
	}
}

func splitOrders(orders []map[string]any, protective func(map[string]any) bool, normalize func(map[string]any) map[string]any) orderBuckets {
	regular := []map[string]any{}
	protectiveOrders := []map[string]any{}
	for _, order := range orders {
		normalized := normalize(order)
		if protective(order) {
			protectiveOrders = append(protectiveOrders, normalized)
			continue
		}
		regular = append(regular, normalized)
	}
	return orderBuckets{
		Regular:    regular,
		Protective: protectiveOrders,
	}
}

func asMap(value any) (map[string]any, bool) {
	m, ok := value.(map[string]any)
	return m, ok
}

func asMapSlice(value any) ([]map[string]any, bool) {
	items, ok := value.([]any)
	if !ok {
		return nil, false
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, false
		}
		result = append(result, entry)
	}
	return result, true
}

func asStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, fmt.Sprint(item))
	}
	return result
}

func toFloat(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		number, _ := typed.Float64()
		return number
	default:
		number, err := json.Number(fmt.Sprint(value)).Float64()
		if err == nil {
			return number
		}
		return 0
	}
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func copyParamsWithLimit(params map[string]string, limit int) map[string]string {
	cloned := map[string]string{}
	for key, value := range params {
		cloned[key] = value
	}
	cloned["limit"] = fmt.Sprintf("%d", limit)
	return cloned
}

func appendProtectiveOrders(buckets *orderBuckets, orders []map[string]any, normalize func(map[string]any) map[string]any) *orderBuckets {
	if buckets == nil {
		buckets = &orderBuckets{
			Regular:    []map[string]any{},
			Protective: []map[string]any{},
		}
	}
	for _, order := range orders {
		buckets.Protective = append(buckets.Protective, normalize(order))
	}
	return buckets
}
