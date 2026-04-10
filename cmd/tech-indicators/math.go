package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

func emaSeries(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	alpha := 2.0 / (float64(period) + 1)
	prev := math.NaN()
	for i, value := range values {
		if !isFinite(value) {
			out[i] = math.NaN()
			continue
		}
		if !isFinite(prev) {
			out[i] = value
			prev = value
			continue
		}
		prev = alpha*value + (1-alpha)*prev
		out[i] = prev
	}
	return out
}

func rmaSeries(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	alpha := 1.0 / float64(period)
	prev := math.NaN()
	for i, value := range values {
		if !isFinite(value) {
			out[i] = math.NaN()
			continue
		}
		if !isFinite(prev) {
			prev = value
		} else {
			prev = alpha*value + (1-alpha)*prev
		}
		out[i] = prev
	}
	return out
}

func smaSeries(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	sum := 0.0
	count := 0
	for i, value := range values {
		if isFinite(value) {
			sum += value
			count++
		}
		if i >= period && isFinite(values[i-period]) {
			sum -= values[i-period]
			count--
		}
		if i >= period-1 && count == period {
			out[i] = sum / float64(period)
		} else {
			out[i] = math.NaN()
		}
	}
	return out
}

func rollingSum(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	sum := 0.0
	count := 0
	for i, value := range values {
		if isFinite(value) {
			sum += value
			count++
		}
		if i >= period && isFinite(values[i-period]) {
			sum -= values[i-period]
			count--
		}
		if i >= period-1 && count == period {
			out[i] = sum
		} else {
			out[i] = math.NaN()
		}
	}
	return out
}

func rollingStd(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range values {
		if i < period-1 {
			out[i] = math.NaN()
			continue
		}
		window := values[i-period+1 : i+1]
		mean := average(window)
		sum := 0.0
		for _, value := range window {
			diff := value - mean
			sum += diff * diff
		}
		out[i] = math.Sqrt(sum / float64(period))
	}
	return out
}

func rollingMin(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range values {
		if i < period-1 {
			out[i] = math.NaN()
			continue
		}
		out[i] = minSlice(values[i-period+1 : i+1])
	}
	return out
}

func rollingMax(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range values {
		if i < period-1 {
			out[i] = math.NaN()
			continue
		}
		out[i] = maxSlice(values[i-period+1 : i+1])
	}
	return out
}

func wmaSeries(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	denom := float64(period*(period+1)) / 2
	for i := range values {
		if i < period-1 {
			out[i] = math.NaN()
			continue
		}
		sum := 0.0
		weight := 1.0
		for j := i - period + 1; j <= i; j++ {
			sum += values[j] * weight
			weight++
		}
		out[i] = sum / denom
	}
	return out
}

func vwmaSeries(price, volume []float64, period int) []float64 {
	out := make([]float64, len(price))
	for i := range price {
		if i < period-1 {
			out[i] = math.NaN()
			continue
		}
		priceVolume := 0.0
		volumeSum := 0.0
		for j := i - period + 1; j <= i; j++ {
			priceVolume += price[j] * volume[j]
			volumeSum += volume[j]
		}
		if volumeSum == 0 {
			out[i] = math.NaN()
		} else {
			out[i] = priceVolume / volumeSum
		}
	}
	return out
}

func hmaSeries(values []float64, period int) []float64 {
	half := maxInt(1, period/2)
	root := maxInt(1, int(math.Sqrt(float64(period))))
	wmaHalf := wmaSeries(values, half)
	wmaFull := wmaSeries(values, period)
	diff := make([]float64, len(values))
	for i := range values {
		if !isFinite(wmaHalf[i]) || !isFinite(wmaFull[i]) {
			diff[i] = math.NaN()
		} else {
			diff[i] = 2*wmaHalf[i] - wmaFull[i]
		}
	}
	return wmaSeries(diff, root)
}

func demaSeries(values []float64, period int) []float64 {
	ema1 := emaSeries(values, period)
	ema2 := emaSeries(ema1, period)
	out := make([]float64, len(values))
	for i := range out {
		if !isFinite(ema1[i]) || !isFinite(ema2[i]) {
			out[i] = math.NaN()
		} else {
			out[i] = 2*ema1[i] - ema2[i]
		}
	}
	return out
}

func temaSeries(values []float64, period int) []float64 {
	ema1 := emaSeries(values, period)
	ema2 := emaSeries(ema1, period)
	ema3 := emaSeries(ema2, period)
	out := make([]float64, len(values))
	for i := range out {
		if !isFinite(ema1[i]) || !isFinite(ema2[i]) || !isFinite(ema3[i]) {
			out[i] = math.NaN()
		} else {
			out[i] = 3*ema1[i] - 3*ema2[i] + ema3[i]
		}
	}
	return out
}

func macdSeries(values []float64, fast, slow, signal int) ([]float64, []float64, []float64) {
	fastEMA := emaSeries(values, fast)
	slowEMA := emaSeries(values, slow)
	macd := combineSeries(fastEMA, slowEMA, func(a, b float64) float64 { return a - b })
	signalLine := emaSeries(macd, signal)
	hist := combineSeries(macd, signalLine, func(a, b float64) float64 { return a - b })
	return macd, signalLine, hist
}

func midpointWindow(high, low []float64, period int) []float64 {
	highest := rollingMax(high, period)
	lowest := rollingMin(low, period)
	return combineSeries(highest, lowest, func(a, b float64) float64 { return (a + b) / 2 })
}

func trueRangeSeries(high, low, close []float64) []float64 {
	out := make([]float64, len(close))
	for i := range close {
		if i == 0 {
			out[i] = high[i] - low[i]
			continue
		}
		a := high[i] - low[i]
		b := math.Abs(high[i] - close[i-1])
		c := math.Abs(low[i] - close[i-1])
		out[i] = math.Max(a, math.Max(b, c))
	}
	return out
}

func atrSeries(high, low, close []float64, period int) []float64 {
	return smaSeries(trueRangeSeries(high, low, close), period)
}

func fieldValues(data *series, field string) []float64 {
	switch strings.ToLower(field) {
	case "open":
		return data.Open
	case "high":
		return data.High
	case "low":
		return data.Low
	case "volume":
		return data.Volume
	default:
		return data.Close
	}
}

func combineSeries(left, right []float64, fn func(float64, float64) float64) []float64 {
	out := make([]float64, len(left))
	for i := range left {
		if !isFinite(left[i]) || !isFinite(right[i]) {
			out[i] = math.NaN()
		} else {
			out[i] = fn(left[i], right[i])
		}
	}
	return out
}

func average(values []float64) float64 {
	sum := 0.0
	count := 0
	for _, value := range values {
		if isFinite(value) {
			sum += value
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

func averagePivotPrice(values []pivot) float64 {
	sum := 0.0
	for _, value := range values {
		sum += value.Price
	}
	return sum / float64(len(values))
}

func minSlice(values []float64) float64 {
	current := math.Inf(1)
	for _, value := range values {
		if value < current {
			current = value
		}
	}
	return current
}

func maxSlice(values []float64) float64 {
	current := math.Inf(-1)
	for _, value := range values {
		if value > current {
			current = value
		}
	}
	return current
}

func firstIndexOfValue(values []float64, target float64) int {
	for index, value := range values {
		if value == target {
			return index
		}
	}
	return -1
}

func linspace(start, end float64, size int) []float64 {
	out := make([]float64, size)
	if size == 1 {
		out[0] = start
		return out
	}
	step := (end - start) / float64(size-1)
	for i := range out {
		out[i] = start + step*float64(i)
	}
	return out
}

func latestValid(values []float64) float64 {
	index := lastValidIndex(values)
	if index < 0 {
		return 0
	}
	return values[index]
}

func previousValid(values []float64) float64 {
	found := 0
	for index := len(values) - 1; index >= 0; index-- {
		if isFinite(values[index]) {
			found++
			if found == 2 {
				return values[index]
			}
		}
	}
	return 0
}

func shiftedLatest(values []float64, displacement int) float64 {
	for index := len(values) - 1 - displacement; index >= 0; index-- {
		if isFinite(values[index]) {
			return values[index]
		}
	}
	return 0
}

func latestValidOffsetCombine(left, right []float64, fn func(float64, float64) float64) float64 {
	index := minInt(lastValidIndex(left), lastValidIndex(right))
	for index >= 0 {
		if isFinite(left[index]) && isFinite(right[index]) {
			return fn(left[index], right[index])
		}
		index--
	}
	return 0
}

func lastValidIndex(values []float64) int {
	for index := len(values) - 1; index >= 0; index-- {
		if isFinite(values[index]) {
			return index
		}
	}
	return -1
}

func dictResult(values map[string]any) map[string]any {
	return map[string]any{"type": "dict", "values": normalizeAnyMap(values)}
}

func dataframeResult(values map[string]any) map[string]any {
	return map[string]any{"type": "dataframe", "values": normalizeAnyMap(values)}
}

func sequenceResult(names []string, values []any) map[string]any {
	result := map[string]any{}
	for index, value := range values {
		key := fmt.Sprintf("item_%d", index)
		if index < len(names) && names[index] != "" {
			key = names[index]
		}
		result[key] = normalizeScalar(value)
	}
	return map[string]any{"type": "sequence", "values": result}
}

func normalizeAnyMap(values map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range values {
		out[key] = normalizeScalar(value)
	}
	return out
}

func normalizeScalar(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case float64:
		if !isFinite(typed) {
			return nil
		}
		return roundTo(typed, 6)
	case float32:
		number := float64(typed)
		if !isFinite(number) {
			return nil
		}
		return roundTo(number, 6)
	default:
		return typed
	}
}

func roundTo(value float64, digits int) float64 {
	factor := math.Pow10(digits)
	return math.Round(value*factor) / factor
}

func paramInt(values map[string]any, key string, fallback int) int {
	value, ok := values[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		parsed, err := strconv.Atoi(fmt.Sprint(value))
		if err != nil {
			return fallback
		}
		return parsed
	}
}

func paramFloat(values map[string]any, key string, fallback float64) float64 {
	value, ok := values[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	default:
		parsed, err := strconv.ParseFloat(fmt.Sprint(value), 64)
		if err != nil {
			return fallback
		}
		return parsed
	}
}

func paramString(values map[string]any, key, fallback string) string {
	value, ok := values[key]
	if !ok {
		return fallback
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" {
		return fallback
	}
	return text
}

func copyAnyMap(input map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		out[key] = value
	}
	return out
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func latestATRAt(values []float64, index int, fallback float64) float64 {
	if len(values) == 0 {
		return fallback
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	for ; index >= 0; index-- {
		if isFinite(values[index]) && values[index] > 0 {
			return values[index]
		}
	}
	return fallback
}

func distancePct(level, current float64) float64 {
	if current == 0 {
		return 0
	}
	return math.Abs(level-current) / math.Abs(current)
}

func sliceSeries(data *series, end int) *series {
	if end < 0 {
		end = 0
	}
	if end > len(data.Close) {
		end = len(data.Close)
	}
	return &series{
		Dates:  append([]time.Time(nil), data.Dates[:end]...),
		Open:   append([]float64(nil), data.Open[:end]...),
		High:   append([]float64(nil), data.High[:end]...),
		Low:    append([]float64(nil), data.Low[:end]...),
		Close:  append([]float64(nil), data.Close[:end]...),
		Volume: append([]float64(nil), data.Volume[:end]...),
	}
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func mustLoadLocation(name string) *time.Location {
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return location
}
