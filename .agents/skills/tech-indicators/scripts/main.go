package main

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	timeframeOrder            = []string{"1w", "1d", "4h", "1h"}
	defaultExcludedIndicators = map[string]struct{}{"supertrend": {}, "pivots_points": {}}
	pivotWindows              = map[string]int{"1w": 4, "1d": 5, "4h": 6, "1h": 8}
	levelDistanceLimits       = map[string]float64{"1w": 0.30, "1d": 0.15, "4h": 0.08, "1h": 0.05}
	validationWindowBars      = map[string]int{"1w": 6, "1d": 8, "4h": 10, "1h": 12}
	highlightIndicatorNames   = []string{"ema", "sma", "bollinger_bands", "supertrend", "ichimoku", "chaikin_money_flow", "atr_percent", "williams_percent"}
	localTimezone             = mustLoadLocation("Asia/Shanghai")
)

const helpText = `Usage:
  go run ./scripts --manifest /tmp/ohlcv/manifest.json
  go run ./scripts --manifest /tmp/ohlcv/manifest.json --indicators ema,sma,rsi

Key flags:
  --manifest <path>          Required manifest path from ohlcv-fetch
  --catalog <path>           Optional indicator catalog JSON
  --indicators <list|all>    Default: all
  --indicator-config <path>  Optional indicator config JSON
  --help                     Show this help
`

type manifestFile struct {
	Symbol     string                       `json:"symbol"`
	Exchange   string                       `json:"exchange"`
	Timeframes map[string]manifestTimeframe `json:"timeframes"`
}

type manifestTimeframe struct {
	File string `json:"file"`
}

type catalogSpec struct {
	Module      string         `json:"module"`
	Function    string         `json:"function"`
	Category    string         `json:"category"`
	Defaults    map[string]any `json:"defaults"`
	OutputNames []string       `json:"output_names"`
	Meaning     string         `json:"meaning"`
	Observe     string         `json:"observe"`
}

type config struct {
	manifestPath    string
	catalogPath     string
	indicators      string
	indicatorConfig string
}

type series struct {
	Dates  []time.Time
	Open   []float64
	High   []float64
	Low    []float64
	Close  []float64
	Volume []float64
}

type pivot struct {
	Index     int     `json:"index"`
	Timestamp string  `json:"timestamp"`
	Price     float64 `json:"price"`
	Kind      string  `json:"kind"`
}

type priceLevel struct {
	Price                float64        `json:"price"`
	ZoneLow              float64        `json:"zone_low"`
	ZoneHigh             float64        `json:"zone_high"`
	Touches              int            `json:"touches"`
	Strength             string         `json:"strength"`
	LastTouchIndex       int            `json:"last_touch_index"`
	LastTouchTime        string         `json:"last_touch_time"`
	SourcePrices         []float64      `json:"source_prices"`
	ClusterSize          int            `json:"cluster_size"`
	ClusterTolerance     float64        `json:"cluster_tolerance"`
	DistanceFromPricePct float64        `json:"distance_from_price_pct"`
	Validation           structureCheck `json:"validation"`
}

type trendline struct {
	Kind                 string         `json:"kind"`
	LineFamily           string         `json:"line_family"`
	StructureRole        string         `json:"structure_role"`
	BreakMeaning         string         `json:"break_meaning"`
	Basis                string         `json:"basis"`
	Scale                string         `json:"scale"`
	AnchorMethod         string         `json:"anchor_method"`
	Confirmation         string         `json:"confirmation"`
	AnchorIndices        []int          `json:"anchor_indices"`
	AnchorPrices         []float64      `json:"anchor_prices"`
	Touches              int            `json:"touches"`
	PivotTouches         int            `json:"pivot_touches"`
	SpanBars             int            `json:"span_bars"`
	TouchTolerance       float64        `json:"touch_tolerance"`
	Slope                float64        `json:"slope"`
	Intercept            float64        `json:"intercept"`
	ProjectedPrice       float64        `json:"projected_price"`
	ProjectedLow         float64        `json:"projected_low"`
	ProjectedHigh        float64        `json:"projected_high"`
	DistanceFromPricePct float64        `json:"distance_from_price_pct"`
	LastTouchIndex       int            `json:"last_touch_index"`
	LastTouchTime        string         `json:"last_touch_time"`
	Invalidation         string         `json:"invalidation"`
	Score                float64        `json:"score"`
	Validation           structureCheck `json:"validation"`
}

type structureCheck struct {
	WindowBars           int     `json:"window_bars"`
	SampleCount          int     `json:"sample_count"`
	Respected            int     `json:"respected"`
	Broken               int     `json:"broken"`
	Unresolved           int     `json:"unresolved"`
	RespectRate          float64 `json:"respect_rate"`
	BreakRate            float64 `json:"break_rate"`
	BreakoutSamples      int     `json:"breakout_samples"`
	RejectedBreakouts    int     `json:"rejected_breakouts"`
	AcceptedBreakouts    int     `json:"accepted_breakouts"`
	AvgBarsOutsideZone   float64 `json:"avg_bars_outside_zone,omitempty"`
	AvgOutsideCloseCount float64 `json:"avg_outside_close_count,omitempty"`
	AvgMaxExcursionPct   float64 `json:"avg_max_excursion_pct,omitempty"`
	AvgReturnToZoneBars  float64 `json:"avg_return_to_zone_bars,omitempty"`
	LastSampleTime       string  `json:"last_sample_time,omitempty"`
	Note                 string  `json:"note,omitempty"`
}

type structureValidationAggregate struct {
	WindowBars              int     `json:"window_bars"`
	SampleStepBars          int     `json:"sample_step_bars"`
	SampleCount             int     `json:"sample_count"`
	Respected               int     `json:"respected"`
	Broken                  int     `json:"broken"`
	Unresolved              int     `json:"unresolved"`
	RespectRate             float64 `json:"respect_rate"`
	BreakRate               float64 `json:"break_rate"`
	BreakoutSamples         int     `json:"breakout_samples"`
	RejectedBreakouts       int     `json:"rejected_breakouts"`
	AcceptedBreakouts       int     `json:"accepted_breakouts"`
	AvgBarsOutsideZone      float64 `json:"avg_bars_outside_zone,omitempty"`
	AvgOutsideCloseCount    float64 `json:"avg_outside_close_count,omitempty"`
	AvgMaxExcursionPct      float64 `json:"avg_max_excursion_pct,omitempty"`
	AvgReturnToZoneBars     float64 `json:"avg_return_to_zone_bars,omitempty"`
	AvgDistanceFromPricePct float64 `json:"avg_distance_from_price_pct"`
	LastSampleTime          string  `json:"last_sample_time,omitempty"`
	Note                    string  `json:"note,omitempty"`
}

type timeframeResult struct {
	Trend               string                                  `json:"trend"`
	CoreContext         map[string]any                          `json:"core_context"`
	Indicators          map[string]any                          `json:"indicators"`
	Supports            []priceLevel                            `json:"supports"`
	Resistances         []priceLevel                            `json:"resistances"`
	Trendlines          []trendline                             `json:"trendlines"`
	StructureValidation map[string]structureValidationAggregate `json:"structure_validation"`
	PositionInRange     string                                  `json:"position_in_range"`
	BullishInvalidation string                                  `json:"bullish_invalidation"`
	BearishInvalidation string                                  `json:"bearish_invalidation"`
}

type indicatorFunc func(data *indicatorInput, params map[string]any, spec catalogSpec) (any, error)

type indicatorInput struct {
	Timeframe  string
	Series     *series
	EMA50      []float64
	EMA200     []float64
	ATR14      []float64
	MACD       []float64
	MACDSignal []float64
	MACDHist   []float64
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
	if wantsHelp(os.Args[1:]) {
		fmt.Print(helpText)
		return nil
	}

	registerIndicators()

	cfg, err := parseFlags()
	if err != nil {
		return err
	}

	manifestPath, err := resolvePathArg(cfg.manifestPath)
	if err != nil {
		return err
	}
	catalogPath, err := resolvePathArg(cfg.catalogPath)
	if err != nil {
		return err
	}

	manifestPayload, err := loadManifest(manifestPath)
	if err != nil {
		return err
	}
	catalog, err := loadIndicatorCatalog(catalogPath)
	if err != nil {
		return err
	}
	indicatorConfig, err := loadIndicatorConfig(cfg.indicatorConfig)
	if err != nil {
		return err
	}

	selectedNames, err := selectedIndicatorNames(cfg.indicators, catalog)
	if err != nil {
		return err
	}

	orderedTimeframes := orderedTimeframesFromManifest(manifestPayload)
	if len(orderedTimeframes) == 0 {
		return fmt.Errorf("no timeframes to analyze in manifest")
	}

	timeframeResults, err := analyzeTimeframes(
		manifestPath,
		manifestPayload,
		orderedTimeframes,
		selectedNames,
		catalog,
		indicatorConfig,
	)
	if err != nil {
		return err
	}

	summary := summarizeOverall(timeframeResults)
	payload := map[string]any{
		"symbol":              manifestPayload.Symbol,
		"exchange":            manifestPayload.Exchange,
		"source_manifest":     manifestPath,
		"generated_at":        time.Now().In(localTimezone).Format(time.RFC3339Nano),
		"selected_indicators": buildSelectedCatalog(catalog, selectedNames, indicatorConfig),
		"timeframes":          timeframeResults,
		"summary":             summary,
		"summary_markdown":    buildMarkdownReport(manifestPayload.Symbol, manifestPayload.Exchange, timeframeResults, summary, selectedNames),
	}

	out, _ := json.MarshalIndent(map[string]any{"ok": true, "data": payload}, "", "  ")
	_, _ = os.Stdout.Write(append(out, '\n'))
	return nil
}

func wantsHelp(args []string) bool {
	for _, arg := range args {
		if arg == "--help" || arg == "-h" {
			return true
		}
	}
	return false
}

func parseFlags() (config, error) {
	var cfg config
	flag.StringVar(&cfg.manifestPath, "manifest", "", "Manifest path from ohlcv-fetch")
	flag.StringVar(&cfg.catalogPath, "catalog", "", "Path to indicator_catalog.json")
	flag.StringVar(&cfg.indicators, "indicators", "all", "Indicator list or all")
	flag.StringVar(&cfg.indicatorConfig, "indicator-config", "", "Optional indicator config JSON")
	flag.Parse()

	if strings.TrimSpace(cfg.manifestPath) == "" {
		return cfg, errors.New("--manifest is required")
	}
	if strings.TrimSpace(cfg.catalogPath) == "" {
		cfg.catalogPath = defaultCatalogPath()
	}
	return cfg, nil
}

func defaultCatalogPath() string {
	execPath, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(execPath), "indicator_catalog.json")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate
		}
	}

	_, sourceFile, _, ok := runtime.Caller(0)
	if ok {
		candidate := filepath.Join(filepath.Dir(sourceFile), "indicator_catalog.json")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate
		}
	}
	return filepath.Join(".agents", "skills", "tech-indicators", "scripts", "indicator_catalog.json")
}

func resolvePathArg(raw string) (string, error) {
	path := strings.TrimSpace(os.ExpandEnv(raw))
	if path == "" {
		return "", nil
	}
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return resolved, nil
}

func loadIndicatorCatalog(path string) (map[string]catalogSpec, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var catalog map[string]catalogSpec
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, err
	}
	return catalog, nil
}

func loadIndicatorConfig(rawPath string) (map[string]map[string]any, error) {
	if strings.TrimSpace(rawPath) == "" {
		return map[string]map[string]any{}, nil
	}

	path, err := resolvePathArg(rawPath)
	if err != nil {
		return nil, err
	}

	body, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("indicator-config not found: %s", path)
	}

	payload := map[string]map[string]any{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errors.New("indicator-config must be a JSON object")
	}
	return payload, nil
}

func loadManifest(path string) (manifestFile, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return manifestFile{}, fmt.Errorf("manifest not found: %s", path)
	}

	var payload manifestFile
	if err := json.Unmarshal(body, &payload); err != nil {
		return manifestFile{}, err
	}
	if strings.TrimSpace(payload.Symbol) == "" {
		return manifestFile{}, errors.New("manifest must include symbol")
	}
	if strings.TrimSpace(payload.Exchange) == "" {
		return manifestFile{}, errors.New("manifest must include exchange")
	}
	if len(payload.Timeframes) == 0 {
		return manifestFile{}, errors.New("manifest must include timeframes.<timeframe>.file entries")
	}
	for timeframe, entry := range payload.Timeframes {
		if strings.TrimSpace(entry.File) == "" {
			return manifestFile{}, fmt.Errorf("manifest timeframe %s is missing file", timeframe)
		}
	}
	return payload, nil
}

func selectedIndicatorNames(raw string, catalog map[string]catalogSpec) ([]string, error) {
	if strings.EqualFold(strings.TrimSpace(raw), "all") {
		names := make([]string, 0, len(catalog))
		for name := range catalog {
			if _, excluded := defaultExcludedIndicators[name]; excluded {
				continue
			}
			names = append(names, name)
		}
		sort.Strings(names)
		return names, nil
	}

	selected := []string{}
	for _, piece := range strings.Split(raw, ",") {
		name := strings.TrimSpace(piece)
		if name == "" {
			continue
		}
		if _, ok := catalog[name]; !ok {
			return nil, fmt.Errorf("unknown indicator: %s", name)
		}
		selected = append(selected, name)
	}
	if len(selected) == 0 {
		return nil, errors.New("no indicators selected")
	}
	return selected, nil
}

func buildSelectedCatalog(
	catalog map[string]catalogSpec,
	selected []string,
	overrides map[string]map[string]any,
) map[string]map[string]any {
	out := map[string]map[string]any{}
	for _, name := range selected {
		spec := catalog[name]
		defaults := copyAnyMap(spec.Defaults)
		for key, value := range overrides[name] {
			defaults[key] = value
		}
		out[name] = map[string]any{
			"module":       spec.Module,
			"function":     spec.Function,
			"category":     spec.Category,
			"defaults":     defaults,
			"output_names": spec.OutputNames,
			"meaning":      spec.Meaning,
			"observe":      spec.Observe,
		}
	}
	return out
}

func orderedTimeframesFromManifest(manifest manifestFile) []string {
	seen := map[string]struct{}{}
	var ordered []string
	for _, timeframe := range timeframeOrder {
		if _, ok := manifest.Timeframes[timeframe]; !ok {
			continue
		}
		ordered = append(ordered, timeframe)
		seen[timeframe] = struct{}{}
	}
	for timeframe := range manifest.Timeframes {
		if _, ok := seen[timeframe]; ok {
			continue
		}
		ordered = append(ordered, timeframe)
	}
	return ordered
}

func analyzeTimeframes(
	manifestPath string,
	manifestPayload manifestFile,
	orderedTimeframes []string,
	selected []string,
	catalog map[string]catalogSpec,
	overrides map[string]map[string]any,
) (map[string]timeframeResult, error) {
	type outcome struct {
		timeframe string
		result    timeframeResult
		err       error
	}

	results := map[string]timeframeResult{}
	outcomes := make(chan outcome, len(orderedTimeframes))

	for _, timeframe := range orderedTimeframes {
		csvPath := resolveManifestMemberPath(manifestPath, manifestPayload.Timeframes[timeframe].File)
		go func(timeframe, csvPath string) {
			data, err := loadOHLCVCSV(csvPath)
			if err != nil {
				outcomes <- outcome{timeframe: timeframe, err: err}
				return
			}
			outcomes <- outcome{
				timeframe: timeframe,
				result:    timeframeAnalysis(timeframe, data, selected, catalog, overrides),
			}
		}(timeframe, csvPath)
	}

	for range len(orderedTimeframes) {
		outcome := <-outcomes
		if outcome.err != nil {
			return nil, outcome.err
		}
		results[outcome.timeframe] = outcome.result
	}
	return results, nil
}

func resolveManifestMemberPath(manifestPath, rawPath string) string {
	expanded := os.ExpandEnv(rawPath)
	if filepath.IsAbs(expanded) {
		return expanded
	}
	return filepath.Join(filepath.Dir(manifestPath), expanded)
}

func loadOHLCVCSV(path string) (*series, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("OHLCV file not found: %s", path)
	}
	defer file.Close()

	rows, err := csv.NewReader(file).ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("%s: insufficient data", path)
	}

	index := map[string]int{}
	for i, name := range rows[0] {
		index[name] = i
	}
	for _, name := range []string{"date", "open", "high", "low", "close", "volume"} {
		if _, ok := index[name]; !ok {
			return nil, fmt.Errorf("%s: missing field %s", path, name)
		}
	}

	data := &series{
		Dates:  make([]time.Time, 0, len(rows)-1),
		Open:   make([]float64, 0, len(rows)-1),
		High:   make([]float64, 0, len(rows)-1),
		Low:    make([]float64, 0, len(rows)-1),
		Close:  make([]float64, 0, len(rows)-1),
		Volume: make([]float64, 0, len(rows)-1),
	}

	for _, row := range rows[1:] {
		dateValue, err := time.Parse(time.RFC3339, row[index["date"]])
		if err != nil {
			return nil, err
		}
		openValue, err := strconv.ParseFloat(row[index["open"]], 64)
		if err != nil {
			return nil, err
		}
		highValue, err := strconv.ParseFloat(row[index["high"]], 64)
		if err != nil {
			return nil, err
		}
		lowValue, err := strconv.ParseFloat(row[index["low"]], 64)
		if err != nil {
			return nil, err
		}
		closeValue, err := strconv.ParseFloat(row[index["close"]], 64)
		if err != nil {
			return nil, err
		}
		volumeValue, err := strconv.ParseFloat(row[index["volume"]], 64)
		if err != nil {
			return nil, err
		}

		data.Dates = append(data.Dates, dateValue)
		data.Open = append(data.Open, openValue)
		data.High = append(data.High, highValue)
		data.Low = append(data.Low, lowValue)
		data.Close = append(data.Close, closeValue)
		data.Volume = append(data.Volume, volumeValue)
	}
	return data, nil
}

func timeframeAnalysis(
	timeframe string,
	data *series,
	selected []string,
	catalog map[string]catalogSpec,
	overrides map[string]map[string]any,
) timeframeResult {
	ema50 := emaSeries(data.Close, 50)
	ema200 := emaSeries(data.Close, 200)
	atr14 := atrSeries(data.High, data.Low, data.Close, 14)
	macdLine, macdSignal, macdHist := macdSeries(data.Close, 12, 26, 9)

	currentPrice := data.Close[len(data.Close)-1]
	highs, lows := detectPivots(data, pivotWindows[timeframe])
	structures := computeStructureSnapshot(timeframe, data, true)
	atrValue := structures.ATRValue
	supports := structures.Supports
	resistances := structures.Resistances
	trendlines := structures.Trendlines

	trend := detectTrend(currentPrice, latestValid(ema50), latestValid(ema200), highs, lows)
	positionInRange := classifyRangePosition(currentPrice, supports, resistances)
	structureValidation := buildWalkForwardStructureValidation(timeframe, data)

	bullishInvalidation := "no near-term support invalidation"
	if len(supports) > 0 {
		bullishInvalidation = fmt.Sprintf("%s close below %.2f", timeframe, supports[0].Price)
	}

	bearishInvalidation := "no near-term resistance invalidation"
	if len(resistances) > 0 {
		bearishInvalidation = fmt.Sprintf("%s close above %.2f", timeframe, resistances[0].Price)
	}

	input := &indicatorInput{
		Timeframe:  timeframe,
		Series:     data,
		EMA50:      ema50,
		EMA200:     ema200,
		ATR14:      atr14,
		MACD:       macdLine,
		MACDSignal: macdSignal,
		MACDHist:   macdHist,
	}

	return timeframeResult{
		Trend: trend,
		CoreContext: map[string]any{
			"current_price":  roundTo(currentPrice, 2),
			"atr_14":         roundTo(atrValue, 2),
			"ema_50":         roundTo(latestValid(ema50), 2),
			"ema_200":        roundTo(latestValid(ema200), 2),
			"macd":           roundTo(latestValid(macdLine), 4),
			"macd_signal":    roundTo(latestValid(macdSignal), 4),
			"macd_histogram": roundTo(latestValid(macdHist), 4),
		},
		Indicators:          computeIndicators(input, selected, catalog, overrides),
		Supports:            supports,
		Resistances:         resistances,
		Trendlines:          trendlines,
		StructureValidation: structureValidation,
		PositionInRange:     positionInRange,
		BullishInvalidation: bullishInvalidation,
		BearishInvalidation: bearishInvalidation,
	}
}
