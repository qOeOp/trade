package main

import (
	"fmt"
	"math"
	"sort"
	"time"
)

type structureSnapshot struct {
	CurrentPrice float64
	ATR14        []float64
	ATRValue     float64
	Supports     []priceLevel
	Resistances  []priceLevel
	Trendlines   []trendline
}

type breakoutMetrics struct {
	Occurred          bool
	Rejected          bool
	Accepted          bool
	BarsOutsideZone   int
	OutsideCloseCount int
	MaxExcursionPct   float64
	ReturnToZoneBars  int
}

type horizontalSignalOutcome struct {
	Outcome  string
	Breakout breakoutMetrics
}

func detectPivots(data *series, window int) ([]pivot, []pivot) {
	if window <= 0 {
		window = 5
	}
	highs := []pivot{}
	lows := []pivot{}
	for index := window; index < len(data.Close)-window; index++ {
		currentHigh := data.High[index]
		currentLow := data.Low[index]
		highWindow := maxSlice(data.High[index-window : index+window+1])
		lowWindow := minSlice(data.Low[index-window : index+window+1])
		timestamp := data.Dates[index].Format(time.RFC3339)
		if currentHigh >= highWindow {
			highs = append(highs, pivot{Index: index, Timestamp: timestamp, Price: currentHigh, Kind: "high"})
		}
		if currentLow <= lowWindow {
			lows = append(lows, pivot{Index: index, Timestamp: timestamp, Price: currentLow, Kind: "low"})
		}
	}
	return highs, lows
}

func detectPivotsForBasis(data *series, window int, basis string) ([]pivot, []pivot) {
	if basis != "close" {
		return detectPivots(data, window)
	}
	if window <= 0 {
		window = 5
	}
	highs := []pivot{}
	lows := []pivot{}
	for index := window; index < len(data.Close)-window; index++ {
		current := data.Close[index]
		windowValues := data.Close[index-window : index+window+1]
		highWindow := maxSlice(windowValues)
		lowWindow := minSlice(windowValues)
		timestamp := data.Dates[index].Format(time.RFC3339)
		if current >= highWindow {
			highs = append(highs, pivot{Index: index, Timestamp: timestamp, Price: current, Kind: "high"})
		}
		if current <= lowWindow {
			lows = append(lows, pivot{Index: index, Timestamp: timestamp, Price: current, Kind: "low"})
		}
	}
	return highs, lows
}

func clusterLevels(
	data *series,
	pivots []pivot,
	kind string,
	atrValue float64,
	clusterPct float64,
	atrMultiplier float64,
	maxLevels int,
) []priceLevel {
	if len(pivots) == 0 {
		return []priceLevel{}
	}

	sortedPivots := append([]pivot(nil), pivots...)
	sort.Slice(sortedPivots, func(i, j int) bool { return sortedPivots[i].Price < sortedPivots[j].Price })
	clusters := [][]pivot{{sortedPivots[0]}}
	for _, point := range sortedPivots[1:] {
		cluster := clusters[len(clusters)-1]
		clusterAvg := averagePivotPrice(cluster)
		tolerance := math.Max(clusterAvg*clusterPct, atrValue*atrMultiplier)
		if math.Abs(point.Price-clusterAvg) <= tolerance {
			clusters[len(clusters)-1] = append(cluster, point)
		} else {
			clusters = append(clusters, []pivot{point})
		}
	}

	levels := []priceLevel{}
	for _, cluster := range clusters {
		avgPrice := averagePivotPrice(cluster)
		tolerance := math.Max(avgPrice*clusterPct, atrValue*atrMultiplier)
		touches := countHorizontalTouches(data, kind, avgPrice, tolerance)
		touchCount := maxInt(len(cluster), len(touches))
		lastTouchIndex := cluster[len(cluster)-1].Index
		if len(touches) > 0 {
			lastTouchIndex = touches[len(touches)-1]
		}
		strength := "weak"
		if touchCount >= 5 {
			strength = "strong"
		} else if touchCount >= 3 {
			strength = "moderate"
		}
		sourcePrices := make([]float64, 0, len(cluster))
		for _, point := range cluster {
			sourcePrices = append(sourcePrices, roundTo(point.Price, 2))
		}
		levels = append(levels, priceLevel{
			Price:            roundTo(avgPrice, 2),
			ZoneLow:          roundTo(avgPrice-tolerance, 2),
			ZoneHigh:         roundTo(avgPrice+tolerance, 2),
			Touches:          touchCount,
			Strength:         strength,
			LastTouchIndex:   lastTouchIndex,
			LastTouchTime:    data.Dates[lastTouchIndex].Format(time.RFC3339),
			SourcePrices:     sourcePrices,
			ClusterSize:      len(cluster),
			ClusterTolerance: roundTo(tolerance, 4),
		})
	}

	sort.Slice(levels, func(i, j int) bool {
		if levels[i].Touches != levels[j].Touches {
			return levels[i].Touches > levels[j].Touches
		}
		return levels[i].LastTouchIndex > levels[j].LastTouchIndex
	})

	deduped := []priceLevel{}
	for _, level := range levels {
		duplicate := false
		for _, existing := range deduped {
			tolerance := math.Max(existing.Price*clusterPct, atrValue*atrMultiplier)
			if math.Abs(level.Price-existing.Price) <= tolerance {
				duplicate = true
				break
			}
		}
		if !duplicate {
			deduped = append(deduped, level)
		}
	}
	if len(deduped) > maxLevels {
		return deduped[:maxLevels]
	}
	return deduped
}

func countHorizontalTouches(data *series, kind string, levelPrice, tolerance float64) []int {
	source := data.Low
	if kind == "resistance" {
		source = data.High
	}
	minGap := maxInt(3, len(source)/80)
	touches := []int{}
	for index, value := range source {
		if math.Abs(value-levelPrice) <= tolerance {
			if len(touches) == 0 || index-touches[len(touches)-1] >= minGap {
				touches = append(touches, index)
			}
		}
	}
	return touches
}

func selectLevels(timeframe string, supports, resistances []priceLevel, currentPrice float64, maxLevels int) ([]priceLevel, []priceLevel) {
	maxDistanceRatio := levelDistanceLimits[timeframe]
	if maxDistanceRatio == 0 {
		maxDistanceRatio = 0.10
	}

	filteredSupports := []priceLevel{}
	for _, level := range supports {
		if level.Price < currentPrice && math.Abs(level.Price-currentPrice)/currentPrice <= maxDistanceRatio {
			filteredSupports = append(filteredSupports, level)
		}
	}
	sort.Slice(filteredSupports, func(i, j int) bool {
		left := currentPrice - filteredSupports[i].Price
		right := currentPrice - filteredSupports[j].Price
		if left != right {
			return left < right
		}
		if filteredSupports[i].LastTouchIndex != filteredSupports[j].LastTouchIndex {
			return filteredSupports[i].LastTouchIndex > filteredSupports[j].LastTouchIndex
		}
		return filteredSupports[i].Touches > filteredSupports[j].Touches
	})
	if len(filteredSupports) == 0 {
		fallback := []priceLevel{}
		for _, level := range supports {
			if level.Price < currentPrice {
				fallback = append(fallback, level)
			}
		}
		sort.Slice(fallback, func(i, j int) bool { return fallback[i].Price > fallback[j].Price })
		if len(fallback) > 0 {
			filteredSupports = fallback[:1]
		}
	}

	filteredResistances := []priceLevel{}
	for _, level := range resistances {
		if level.Price > currentPrice && math.Abs(level.Price-currentPrice)/currentPrice <= maxDistanceRatio {
			filteredResistances = append(filteredResistances, level)
		}
	}
	sort.Slice(filteredResistances, func(i, j int) bool {
		left := filteredResistances[i].Price - currentPrice
		right := filteredResistances[j].Price - currentPrice
		if left != right {
			return left < right
		}
		if filteredResistances[i].LastTouchIndex != filteredResistances[j].LastTouchIndex {
			return filteredResistances[i].LastTouchIndex > filteredResistances[j].LastTouchIndex
		}
		return filteredResistances[i].Touches > filteredResistances[j].Touches
	})
	if len(filteredResistances) == 0 {
		fallback := []priceLevel{}
		for _, level := range resistances {
			if level.Price > currentPrice {
				fallback = append(fallback, level)
			}
		}
		sort.Slice(fallback, func(i, j int) bool { return fallback[i].Price < fallback[j].Price })
		if len(fallback) > 0 {
			filteredResistances = fallback[:1]
		}
	}

	if len(filteredSupports) > maxLevels {
		filteredSupports = filteredSupports[:maxLevels]
	}
	if len(filteredResistances) > maxLevels {
		filteredResistances = filteredResistances[:maxLevels]
	}
	return filteredSupports, filteredResistances
}

func detectTrendlines(
	data *series,
	pivots []pivot,
	kind string,
	timeframe string,
	atrValue float64,
	currentPrice float64,
	maxLines int,
	basis string,
	scale string,
) []trendline {
	if len(pivots) < 3 {
		return []trendline{}
	}
	recent := pivots
	if len(recent) > 14 {
		recent = recent[len(recent)-14:]
	}
	candidates := []trendline{}
	for left := 0; left < len(recent)-1; left++ {
		for right := left + 1; right < len(recent); right++ {
			first := recent[left]
			second := recent[right]
			span := second.Index - first.Index
			if span < 8 {
				continue
			}
			firstScaled := projectPriceToScale(first.Price, scale)
			secondScaled := projectPriceToScale(second.Price, scale)
			if !isFinite(firstScaled) || !isFinite(secondScaled) {
				continue
			}
			slope := (secondScaled - firstScaled) / float64(span)
			intercept := firstScaled - slope*float64(first.Index)
			pivotTouches := countLineTouches(recent, slope, intercept, atrValue, 0.0035, scale)
			if len(pivotTouches) < 2 {
				continue
			}
			touchIndices := countTrendlineTouches(data, kind, basis, scale, first.Index, slope, intercept, atrValue)
			if len(touchIndices) < 3 {
				continue
			}
			if lineBroken(data, kind, scale, second.Index+1, slope, intercept, atrValue) {
				continue
			}
			projected := trendlinePriceAt(len(data.Close)-1, slope, intercept, scale)
			score := float64(len(touchIndices))*18 + math.Min(float64(span), 240)*0.08 - math.Abs(projected-currentPrice)/math.Max(atrValue, 1.0)
			invalidationSide := "above"
			if kind == "support" {
				invalidationSide = "below"
			}
			lastTouchIndex := touchIndices[len(touchIndices)-1]
			touchTolerance := math.Max(math.Abs(projected)*0.0035, atrValue*0.45)
			candidates = append(candidates, trendline{
				Kind:           kind,
				Basis:          basis,
				Scale:          scale,
				AnchorMethod:   "two-pivot",
				Confirmation:   classifyTrendlineConfirmation(len(pivotTouches), len(touchIndices)),
				AnchorIndices:  []int{first.Index, second.Index},
				AnchorPrices:   []float64{roundTo(first.Price, 2), roundTo(second.Price, 2)},
				Touches:        len(touchIndices),
				PivotTouches:   len(pivotTouches),
				SpanBars:       span,
				TouchTolerance: roundTo(touchTolerance, 4),
				Slope:          roundTo(slope, 6),
				Intercept:      roundTo(intercept, 2),
				ProjectedPrice: roundTo(projected, 2),
				ProjectedLow:   roundTo(projected-touchTolerance, 2),
				ProjectedHigh:  roundTo(projected+touchTolerance, 2),
				LastTouchIndex: lastTouchIndex,
				LastTouchTime:  data.Dates[lastTouchIndex].Format(time.RFC3339),
				Invalidation:   fmt.Sprintf("%s close %s trendline (%.2f)", timeframe, invalidationSide, projected),
				Score:          roundTo(score, 2),
			})
		}
	}

	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Score > candidates[j].Score })
	selected := []trendline{}
	for _, candidate := range candidates {
		duplicate := false
		for _, existing := range selected {
			projectedGap := math.Abs(candidate.ProjectedPrice - existing.ProjectedPrice)
			slopeGap := math.Abs(candidate.Slope - existing.Slope)
			if projectedGap <= math.Max(atrValue*0.5, currentPrice*0.0025) && slopeGap <= 0.02 {
				duplicate = true
				break
			}
		}
		if !duplicate {
			selected = append(selected, candidate)
		}
		if len(selected) >= maxLines {
			break
		}
	}
	return annotateTrendlineMetadata(selected)
}

func countLineTouches(pivots []pivot, slope, intercept, atrValue, proximityPct float64, scale string) []pivot {
	touched := []pivot{}
	for _, point := range pivots {
		linePrice := trendlinePriceAt(point.Index, slope, intercept, scale)
		tolerance := math.Max(math.Abs(linePrice)*proximityPct, atrValue*0.35)
		if math.Abs(point.Price-linePrice) <= tolerance {
			touched = append(touched, point)
		}
	}
	return touched
}

func countTrendlineTouches(data *series, kind, basis, scale string, startIndex int, slope, intercept, atrValue float64) []int {
	source := trendlineTouchSource(data, kind, basis)
	minGap := maxInt(4, len(source)/90)
	touches := []int{}
	for index := startIndex; index < len(source); index++ {
		linePrice := trendlinePriceAt(index, slope, intercept, scale)
		tolerance := math.Max(math.Abs(linePrice)*0.0035, atrValue*0.45)
		if math.Abs(source[index]-linePrice) <= tolerance {
			if len(touches) == 0 || index-touches[len(touches)-1] >= minGap {
				touches = append(touches, index)
			}
		}
	}
	return touches
}

func lineBroken(data *series, kind, scale string, startIndex int, slope, intercept, atrValue float64) bool {
	for index := startIndex; index < len(data.Close); index++ {
		linePrice := trendlinePriceAt(index, slope, intercept, scale)
		tolerance := math.Max(math.Abs(linePrice)*0.0015, atrValue*0.25)
		if kind == "support" && data.Close[index] < linePrice-tolerance {
			return true
		}
		if kind == "resistance" && data.Close[index] > linePrice+tolerance {
			return true
		}
	}
	return false
}

func detectTrend(currentPrice, ema50Value, ema200Value float64, highs, lows []pivot) string {
	higherHigh := len(highs) >= 2 && highs[len(highs)-1].Price > highs[len(highs)-2].Price
	higherLow := len(lows) >= 2 && lows[len(lows)-1].Price > lows[len(lows)-2].Price
	lowerHigh := len(highs) >= 2 && highs[len(highs)-1].Price < highs[len(highs)-2].Price
	lowerLow := len(lows) >= 2 && lows[len(lows)-1].Price < lows[len(lows)-2].Price

	if currentPrice > ema50Value && ema50Value > ema200Value && higherHigh && higherLow {
		return "bullish"
	}
	if currentPrice < ema50Value && ema50Value < ema200Value && lowerHigh && lowerLow {
		return "bearish"
	}
	if currentPrice > ema200Value && higherLow {
		return "bullish-leaning"
	}
	if currentPrice < ema200Value && lowerHigh {
		return "bearish-leaning"
	}
	return "neutral"
}

func classifyRangePosition(currentPrice float64, supports, resistances []priceLevel) string {
	if len(supports) == 0 || len(resistances) == 0 {
		return "unbounded"
	}
	span := resistances[0].Price - supports[0].Price
	if span <= 0 {
		return "compressed"
	}
	ratio := (currentPrice - supports[0].Price) / span
	switch {
	case ratio < 0.25:
		return "lower-quarter"
	case ratio < 0.45:
		return "lower-middle"
	case ratio < 0.65:
		return "mid-range"
	case ratio < 0.85:
		return "upper-middle"
	default:
		return "upper-quarter"
	}
}

func summarizeOverall(results map[string]timeframeResult) map[string]string {
	weights := map[string]int{"1w": 4, "1d": 3, "4h": 2, "1h": 1}
	score := 0
	for timeframe, result := range results {
		weight := weights[timeframe]
		if weight == 0 {
			weight = 1
		}
		score += timeframeBiasLabel(result.Trend) * weight
	}
	switch {
	case score >= 7:
		return map[string]string{"bias": "bullish", "suggestion": "wait for pullback to support"}
	case score >= 2:
		return map[string]string{"bias": "slightly-bullish", "suggestion": "wait for pullback or lower-timeframe reclaim"}
	case score <= -7:
		return map[string]string{"bias": "bearish", "suggestion": "wait for bounce to resistance"}
	case score <= -2:
		return map[string]string{"bias": "slightly-bearish", "suggestion": "wait for bounce or lower-timeframe breakdown"}
	default:
		return map[string]string{"bias": "neutral", "suggestion": "observe, wait for range edge or breakout confirmation"}
	}
}

func timeframeBiasLabel(trend string) int {
	switch trend {
	case "bullish":
		return 2
	case "bullish-leaning":
		return 1
	case "bearish":
		return -2
	case "bearish-leaning":
		return -1
	default:
		return 0
	}
}

func annotateTrendlineMetadata(lines []trendline) []trendline {
	if len(lines) == 0 {
		return lines
	}

	grouped := map[string][]int{}
	for index, line := range lines {
		key := fmt.Sprintf("%s:%s:%s:%s", line.Kind, line.Basis, line.Scale, classifySlopeDirection(line.Slope))
		grouped[key] = append(grouped[key], index)
	}

	for _, indices := range grouped {
		baseIndex := indices[0]
		for _, candidateIndex := range indices[1:] {
			base := lines[baseIndex]
			candidate := lines[candidateIndex]
			if candidate.SpanBars > base.SpanBars {
				baseIndex = candidateIndex
				continue
			}
			if candidate.SpanBars == base.SpanBars && math.Abs(candidate.Slope) < math.Abs(base.Slope) {
				baseIndex = candidateIndex
			}
		}

		baseSlope := math.Abs(lines[baseIndex].Slope)
		baseSpan := maxInt(lines[baseIndex].SpanBars, 1)
		for _, index := range indices {
			lines[index].LineFamily = "base"
			if index == baseIndex {
				continue
			}
			absSlope := math.Abs(lines[index].Slope)
			if absSlope > baseSlope*1.15 && lines[index].SpanBars <= int(float64(baseSpan)*0.9) {
				lines[index].LineFamily = "acceleration"
			}
		}
	}

	supportIndices := []int{}
	resistanceIndices := []int{}
	for index, line := range lines {
		if line.Kind == "support" {
			supportIndices = append(supportIndices, index)
		} else if line.Kind == "resistance" {
			resistanceIndices = append(resistanceIndices, index)
		}
	}
	assignTrendlineRoles(lines, supportIndices, true)
	assignTrendlineRoles(lines, resistanceIndices, false)

	for index := range lines {
		if lines[index].LineFamily == "acceleration" {
			lines[index].BreakMeaning = "loss_of_acceleration"
		} else {
			lines[index].BreakMeaning = "structure_risk"
		}
	}

	return lines
}

func assignTrendlineRoles(lines []trendline, indices []int, support bool) {
	if len(indices) == 0 {
		return
	}
	grouped := map[string][]int{}
	for _, index := range indices {
		key := fmt.Sprintf("%s:%s", lines[index].Basis, lines[index].Scale)
		grouped[key] = append(grouped[key], index)
	}
	for _, group := range grouped {
		if len(group) == 1 {
			lines[group[0]].StructureRole = "boundary"
			continue
		}
		ordered := append([]int(nil), group...)
		sort.Slice(ordered, func(i, j int) bool {
			left := lines[ordered[i]].ProjectedPrice
			right := lines[ordered[j]].ProjectedPrice
			if support {
				return left < right
			}
			return left > right
		})
		lines[ordered[0]].StructureRole = "boundary"
		for _, index := range ordered[1:] {
			lines[index].StructureRole = "internal"
		}
	}
}

func classifyTrendlineConfirmation(pivotTouches, touches int) string {
	switch {
	case pivotTouches >= 3 && touches >= 5:
		return "confirmed"
	case pivotTouches >= 2 && touches >= 3:
		return "developing"
	default:
		return "early"
	}
}

func classifySlopeDirection(slope float64) string {
	switch {
	case slope > 0.0001:
		return "ascending"
	case slope < -0.0001:
		return "descending"
	default:
		return "flat"
	}
}

func trendlineTouchSource(data *series, kind, basis string) []float64 {
	if basis == "close" {
		return data.Close
	}
	if kind == "resistance" {
		return data.High
	}
	return data.Low
}

func trendlineReactionSource(data *series, direction, basis string) []float64 {
	if basis == "close" {
		return data.Close
	}
	if direction == "up" {
		return data.High
	}
	return data.Low
}

func trendlinePriceAt(index int, slope, intercept float64, scale string) float64 {
	scaledValue := slope*float64(index) + intercept
	return projectPriceFromScale(scaledValue, scale)
}

func projectPriceToScale(price float64, scale string) float64 {
	if scale == "log" {
		if price <= 0 {
			return math.NaN()
		}
		return math.Log(price)
	}
	return price
}

func projectPriceFromScale(value float64, scale string) float64 {
	if scale == "log" {
		return math.Exp(value)
	}
	return value
}

func computeStructureSnapshot(timeframe string, data *series, enrich bool) structureSnapshot {
	currentPrice := data.Close[len(data.Close)-1]
	atr14 := atrSeries(data.High, data.Low, data.Close, 14)
	atrValue := latestValid(atr14)
	if atrValue == 0 {
		atrValue = math.Max(currentPrice*0.005, 1.0)
	}

	highs, lows := detectPivots(data, pivotWindows[timeframe])
	supportCandidates := clusterLevels(data, lows, "support", atrValue, 0.005, 0.8, 8)
	resistanceCandidates := clusterLevels(data, highs, "resistance", atrValue, 0.005, 0.8, 8)
	supports, resistances := selectLevels(timeframe, supportCandidates, resistanceCandidates, currentPrice, 5)

	trendlines := []trendline{}
	for _, basis := range []string{"wick", "close"} {
		variantHighs, variantLows := detectPivotsForBasis(data, pivotWindows[timeframe], basis)
		for _, scale := range []string{"linear", "log"} {
			trendlines = append(trendlines,
				detectTrendlines(data, variantLows, "support", timeframe, atrValue, currentPrice, 2, basis, scale)...,
			)
			trendlines = append(trendlines,
				detectTrendlines(data, variantHighs, "resistance", timeframe, atrValue, currentPrice, 2, basis, scale)...,
			)
		}
	}
	sort.Slice(trendlines, func(i, j int) bool { return trendlines[i].Score > trendlines[j].Score })
	if len(trendlines) > 8 {
		trendlines = trendlines[:8]
	}

	if enrich {
		supports = enrichStructureLevels(data, atr14, currentPrice, timeframe, "support", supports)
		resistances = enrichStructureLevels(data, atr14, currentPrice, timeframe, "resistance", resistances)
		trendlines = enrichTrendlines(data, atr14, currentPrice, timeframe, trendlines)
	}

	return structureSnapshot{
		CurrentPrice: currentPrice,
		ATR14:        atr14,
		ATRValue:     atrValue,
		Supports:     supports,
		Resistances:  resistances,
		Trendlines:   trendlines,
	}
}

func buildWalkForwardStructureValidation(timeframe string, data *series) map[string]structureValidationAggregate {
	windowBars := validationWindowBars[timeframe]
	if windowBars == 0 {
		windowBars = 8
	}
	sampleStep := maxInt(1, windowBars/2)
	minBars := maxInt(120, pivotWindows[timeframe]*20)
	result := map[string]structureValidationAggregate{
		"support":                   {WindowBars: windowBars, SampleStepBars: sampleStep},
		"resistance":                {WindowBars: windowBars, SampleStepBars: sampleStep},
		"support_trendline_overall": {WindowBars: windowBars, SampleStepBars: sampleStep},
		"resistance_trendline_overall": {
			WindowBars:     windowBars,
			SampleStepBars: sampleStep,
		},
	}
	for _, variant := range trendlineValidationVariants() {
		result[trendlineVariantValidationKey(variant.kind, variant.basis, variant.scale)] = structureValidationAggregate{
			WindowBars:     windowBars,
			SampleStepBars: sampleStep,
		}
	}
	if len(data.Close) < minBars+windowBars+1 {
		note := fmt.Sprintf("not enough bars for walk-forward validation, need at least %d", minBars+windowBars+1)
		for key, aggregate := range result {
			aggregate.Note = note
			result[key] = aggregate
		}
		return result
	}

	distanceTotals := map[string]float64{}
	lastSampleIndices := map[string]int{}
	for cutoff := minBars - 1; cutoff < len(data.Close)-windowBars-1; cutoff += sampleStep {
		prefix := sliceSeries(data, cutoff+1)
		snapshot := computeStructureSnapshot(timeframe, prefix, false)

		if len(snapshot.Supports) > 0 {
			aggregate := result["support"]
			distanceTotals["support"] += distancePct(snapshot.Supports[0].Price, snapshot.CurrentPrice)
			outcome := evaluateHorizontalSignalOutcome(data, snapshot.ATR14, snapshot.Supports[0], "support", cutoff, windowBars)
			aggregate = applyWalkForwardOutcome(aggregate, outcome)
			lastSampleIndices["support"] = cutoff
			result["support"] = aggregate
		}
		if len(snapshot.Resistances) > 0 {
			aggregate := result["resistance"]
			distanceTotals["resistance"] += distancePct(snapshot.Resistances[0].Price, snapshot.CurrentPrice)
			outcome := evaluateHorizontalSignalOutcome(data, snapshot.ATR14, snapshot.Resistances[0], "resistance", cutoff, windowBars)
			aggregate = applyWalkForwardOutcome(aggregate, outcome)
			lastSampleIndices["resistance"] = cutoff
			result["resistance"] = aggregate
		}

		if supportLine, ok := firstTrendlineOfKind(snapshot.Trendlines, "support"); ok {
			aggregate := result["support_trendline_overall"]
			distanceTotals["support_trendline_overall"] += distancePct(supportLine.ProjectedPrice, snapshot.CurrentPrice)
			aggregate = applyWalkForwardOutcomeLabel(
				aggregate,
				evaluateTrendlineSignalOutcome(data, snapshot.ATR14, supportLine, cutoff, windowBars),
			)
			lastSampleIndices["support_trendline_overall"] = cutoff
			result["support_trendline_overall"] = aggregate
		}
		if resistanceLine, ok := firstTrendlineOfKind(snapshot.Trendlines, "resistance"); ok {
			aggregate := result["resistance_trendline_overall"]
			distanceTotals["resistance_trendline_overall"] += distancePct(resistanceLine.ProjectedPrice, snapshot.CurrentPrice)
			aggregate = applyWalkForwardOutcomeLabel(
				aggregate,
				evaluateTrendlineSignalOutcome(data, snapshot.ATR14, resistanceLine, cutoff, windowBars),
			)
			lastSampleIndices["resistance_trendline_overall"] = cutoff
			result["resistance_trendline_overall"] = aggregate
		}
		for _, variant := range trendlineValidationVariants() {
			key := trendlineVariantValidationKey(variant.kind, variant.basis, variant.scale)
			line, ok := firstTrendlineVariant(snapshot.Trendlines, variant.kind, variant.basis, variant.scale)
			if !ok {
				continue
			}
			aggregate := result[key]
			distanceTotals[key] += distancePct(line.ProjectedPrice, snapshot.CurrentPrice)
			aggregate = applyWalkForwardOutcomeLabel(
				aggregate,
				evaluateTrendlineSignalOutcome(data, snapshot.ATR14, line, cutoff, windowBars),
			)
			lastSampleIndices[key] = cutoff
			result[key] = aggregate
		}
	}

	for key, aggregate := range result {
		if aggregate.SampleCount == 0 {
			if aggregate.Note == "" {
				aggregate.Note = "no eligible walk-forward samples"
			}
			result[key] = aggregate
			continue
		}
		aggregate.RespectRate = roundTo(float64(aggregate.Respected)/float64(aggregate.SampleCount), 4)
		aggregate.BreakRate = roundTo(float64(aggregate.Broken)/float64(aggregate.SampleCount), 4)
		aggregate = finalizeBreakoutMetricsForAggregate(aggregate)
		aggregate.AvgDistanceFromPricePct = roundTo(distanceTotals[key]/float64(aggregate.SampleCount), 4)
		if index, ok := lastSampleIndices[key]; ok && index >= 0 && index < len(data.Dates) {
			aggregate.LastSampleTime = data.Dates[index].Format(time.RFC3339)
		}
		result[key] = aggregate
	}

	return result
}

func trendlineValidationVariants() []struct {
	kind  string
	basis string
	scale string
} {
	return []struct {
		kind  string
		basis string
		scale string
	}{
		{kind: "support", basis: "wick", scale: "linear"},
		{kind: "support", basis: "wick", scale: "log"},
		{kind: "support", basis: "close", scale: "linear"},
		{kind: "support", basis: "close", scale: "log"},
		{kind: "resistance", basis: "wick", scale: "linear"},
		{kind: "resistance", basis: "wick", scale: "log"},
		{kind: "resistance", basis: "close", scale: "linear"},
		{kind: "resistance", basis: "close", scale: "log"},
	}
}

func trendlineVariantValidationKey(kind, basis, scale string) string {
	return fmt.Sprintf("%s_trendline_%s_%s", kind, basis, scale)
}

func applyWalkForwardOutcome(aggregate structureValidationAggregate, outcome horizontalSignalOutcome) structureValidationAggregate {
	aggregate.SampleCount++
	switch outcome.Outcome {
	case "respected":
		aggregate.Respected++
	case "broken":
		aggregate.Broken++
	default:
		aggregate.Unresolved++
	}
	aggregate = applyBreakoutMetricsToAggregate(aggregate, outcome.Breakout)
	return aggregate
}

func applyWalkForwardOutcomeLabel(aggregate structureValidationAggregate, outcome string) structureValidationAggregate {
	aggregate.SampleCount++
	switch outcome {
	case "respected":
		aggregate.Respected++
	case "broken":
		aggregate.Broken++
	default:
		aggregate.Unresolved++
	}
	return aggregate
}

func evaluateHorizontalSignalOutcome(data *series, atr []float64, level priceLevel, kind string, cutoff, windowBars int) horizontalSignalOutcome {
	end := minInt(len(data.Close)-1, cutoff+windowBars)
	atrValue := latestATRAt(atr, cutoff, math.Abs(level.Price)*0.005)
	reactionThreshold := math.Max(atrValue*0.35, math.Abs(level.Price)*0.0025)
	breakThreshold := math.Max(atrValue*0.25, math.Abs(level.Price)*0.0015)
	outcome := horizontalSignalOutcome{Outcome: "unresolved"}
	for index := cutoff + 1; index <= end; index++ {
		if kind == "support" {
			if data.Close[index] < level.ZoneLow-breakThreshold {
				outcome.Outcome = "broken"
				outcome.Breakout = measureHorizontalBreakout(data, kind, level, index, end)
				return outcome
			}
			if data.High[index] >= level.Price+reactionThreshold {
				outcome.Outcome = "respected"
				return outcome
			}
			continue
		}
		if data.Close[index] > level.ZoneHigh+breakThreshold {
			outcome.Outcome = "broken"
			outcome.Breakout = measureHorizontalBreakout(data, kind, level, index, end)
			return outcome
		}
		if data.Low[index] <= level.Price-reactionThreshold {
			outcome.Outcome = "respected"
			return outcome
		}
	}
	return outcome
}

func evaluateTrendlineSignalOutcome(data *series, atr []float64, line trendline, cutoff, windowBars int) string {
	end := minInt(len(data.Close)-1, cutoff+windowBars)
	projected := trendlinePriceAt(cutoff, line.Slope, line.Intercept, line.Scale)
	atrValue := latestATRAt(atr, cutoff, math.Abs(projected)*0.005)
	reactionThreshold := math.Max(atrValue*0.35, math.Abs(projected)*0.0025)
	breakThreshold := math.Max(atrValue*0.25, math.Abs(projected)*0.0015)
	reactionUp := trendlineReactionSource(data, "up", line.Basis)
	reactionDown := trendlineReactionSource(data, "down", line.Basis)
	for index := cutoff + 1; index <= end; index++ {
		linePrice := trendlinePriceAt(index, line.Slope, line.Intercept, line.Scale)
		if line.Kind == "support" {
			if data.Close[index] < linePrice-breakThreshold {
				return "broken"
			}
			if reactionUp[index] >= linePrice+reactionThreshold {
				return "respected"
			}
			continue
		}
		if data.Close[index] > linePrice+breakThreshold {
			return "broken"
		}
		if reactionDown[index] <= linePrice-reactionThreshold {
			return "respected"
		}
	}
	return "unresolved"
}

func firstTrendlineOfKind(lines []trendline, kind string) (trendline, bool) {
	for _, line := range lines {
		if line.Kind == kind {
			return line, true
		}
	}
	return trendline{}, false
}

func firstTrendlineVariant(lines []trendline, kind, basis, scale string) (trendline, bool) {
	for _, line := range lines {
		if line.Kind == kind && line.Basis == basis && line.Scale == scale {
			return line, true
		}
	}
	return trendline{}, false
}

func measureHorizontalBreakout(data *series, kind string, level priceLevel, breakoutIndex, end int) breakoutMetrics {
	metrics := breakoutMetrics{Occurred: true}
	outsideCount := 0
	firstReturnBars := -1
	for index := breakoutIndex; index <= end; index++ {
		outsideClose := false
		excursionPct := 0.0
		if kind == "support" {
			outsideClose = data.Close[index] < level.ZoneLow
			if data.Low[index] < level.ZoneLow {
				excursionPct = (level.ZoneLow - data.Low[index]) / math.Max(level.Price, 1.0)
			}
		} else {
			outsideClose = data.Close[index] > level.ZoneHigh
			if data.High[index] > level.ZoneHigh {
				excursionPct = (data.High[index] - level.ZoneHigh) / math.Max(level.Price, 1.0)
			}
		}
		if excursionPct > metrics.MaxExcursionPct {
			metrics.MaxExcursionPct = excursionPct
		}
		if outsideClose {
			metrics.OutsideCloseCount++
			if firstReturnBars == -1 {
				outsideCount++
			}
			continue
		}
		if firstReturnBars == -1 {
			firstReturnBars = index - breakoutIndex
		}
	}
	metrics.BarsOutsideZone = outsideCount
	if firstReturnBars >= 0 {
		metrics.Rejected = true
		metrics.ReturnToZoneBars = firstReturnBars
	} else {
		metrics.Accepted = true
	}
	metrics.MaxExcursionPct = roundTo(metrics.MaxExcursionPct, 4)
	return metrics
}

func applyBreakoutMetricsToAggregate(aggregate structureValidationAggregate, metrics breakoutMetrics) structureValidationAggregate {
	if !metrics.Occurred {
		return aggregate
	}
	aggregate.BreakoutSamples++
	if metrics.Rejected {
		aggregate.RejectedBreakouts++
	}
	if metrics.Accepted {
		aggregate.AcceptedBreakouts++
	}
	aggregate.AvgBarsOutsideZone += float64(metrics.BarsOutsideZone)
	aggregate.AvgOutsideCloseCount += float64(metrics.OutsideCloseCount)
	aggregate.AvgMaxExcursionPct += metrics.MaxExcursionPct
	if metrics.Rejected {
		aggregate.AvgReturnToZoneBars += float64(metrics.ReturnToZoneBars)
	}
	return aggregate
}

func applyBreakoutMetricsToCheck(check structureCheck, metrics breakoutMetrics) structureCheck {
	if !metrics.Occurred {
		return check
	}
	check.BreakoutSamples++
	if metrics.Rejected {
		check.RejectedBreakouts++
	}
	if metrics.Accepted {
		check.AcceptedBreakouts++
	}
	check.AvgBarsOutsideZone += float64(metrics.BarsOutsideZone)
	check.AvgOutsideCloseCount += float64(metrics.OutsideCloseCount)
	check.AvgMaxExcursionPct += metrics.MaxExcursionPct
	if metrics.Rejected {
		check.AvgReturnToZoneBars += float64(metrics.ReturnToZoneBars)
	}
	return check
}

func finalizeBreakoutMetricsForAggregate(aggregate structureValidationAggregate) structureValidationAggregate {
	if aggregate.BreakoutSamples == 0 {
		return aggregate
	}
	aggregate.AvgBarsOutsideZone = roundTo(aggregate.AvgBarsOutsideZone/float64(aggregate.BreakoutSamples), 2)
	aggregate.AvgOutsideCloseCount = roundTo(aggregate.AvgOutsideCloseCount/float64(aggregate.BreakoutSamples), 2)
	aggregate.AvgMaxExcursionPct = roundTo(aggregate.AvgMaxExcursionPct/float64(aggregate.BreakoutSamples), 4)
	if aggregate.RejectedBreakouts > 0 {
		aggregate.AvgReturnToZoneBars = roundTo(aggregate.AvgReturnToZoneBars/float64(aggregate.RejectedBreakouts), 2)
	} else {
		aggregate.AvgReturnToZoneBars = 0
	}
	return aggregate
}

func finalizeBreakoutMetricsForCheck(check structureCheck) structureCheck {
	if check.BreakoutSamples == 0 {
		return check
	}
	check.AvgBarsOutsideZone = roundTo(check.AvgBarsOutsideZone/float64(check.BreakoutSamples), 2)
	check.AvgOutsideCloseCount = roundTo(check.AvgOutsideCloseCount/float64(check.BreakoutSamples), 2)
	check.AvgMaxExcursionPct = roundTo(check.AvgMaxExcursionPct/float64(check.BreakoutSamples), 4)
	if check.RejectedBreakouts > 0 {
		check.AvgReturnToZoneBars = roundTo(check.AvgReturnToZoneBars/float64(check.RejectedBreakouts), 2)
	} else {
		check.AvgReturnToZoneBars = 0
	}
	return check
}

func enrichStructureLevels(
	data *series,
	atr []float64,
	currentPrice float64,
	timeframe string,
	kind string,
	levels []priceLevel,
) []priceLevel {
	for index := range levels {
		level := &levels[index]
		level.DistanceFromPricePct = roundTo(distancePct(level.Price, currentPrice), 4)
		touches := countHorizontalTouches(data, kind, level.Price, level.ClusterTolerance)
		level.Validation = validateHorizontalLevel(data, atr, *level, kind, timeframe, touches)
	}
	return levels
}

func enrichTrendlines(
	data *series,
	atr []float64,
	currentPrice float64,
	timeframe string,
	lines []trendline,
) []trendline {
	for index := range lines {
		line := &lines[index]
		line.DistanceFromPricePct = roundTo(distancePct(line.ProjectedPrice, currentPrice), 4)
		touches := countTrendlineTouches(
			data,
			line.Kind,
			line.Basis,
			line.Scale,
			line.AnchorIndices[0],
			line.Slope,
			line.Intercept,
			latestATRAt(atr, line.AnchorIndices[0], math.Abs(line.ProjectedPrice)*0.005),
		)
		line.Validation = validateTrendline(data, atr, *line, timeframe, touches)
	}
	return lines
}

func validateHorizontalLevel(data *series, atr []float64, level priceLevel, kind string, timeframe string, touches []int) structureCheck {
	windowBars := validationWindowBars[timeframe]
	if windowBars == 0 {
		windowBars = 8
	}
	check := structureCheck{WindowBars: windowBars}
	if len(touches) == 0 {
		check.Note = "no historical touches available"
		return check
	}

	lastSampleIndex := -1
	for _, touchIndex := range touches {
		if touchIndex >= len(data.Close)-1 {
			continue
		}
		end := minInt(len(data.Close)-1, touchIndex+windowBars)
		if end <= touchIndex {
			continue
		}
		outcome := evaluateHorizontalSignalOutcome(data, atr, level, kind, touchIndex, windowBars)
		check.SampleCount++
		lastSampleIndex = touchIndex
		switch outcome.Outcome {
		case "respected":
			check.Respected++
		case "broken":
			check.Broken++
		default:
			check.Unresolved++
		}
		check = applyBreakoutMetricsToCheck(check, outcome.Breakout)
	}

	check = finalizeBreakoutMetricsForCheck(check)
	return finalizeStructureCheck(data, check, lastSampleIndex)
}

func validateTrendline(
	data *series,
	atr []float64,
	line trendline,
	timeframe string,
	touches []int,
) structureCheck {
	windowBars := validationWindowBars[timeframe]
	if windowBars == 0 {
		windowBars = 8
	}
	check := structureCheck{WindowBars: windowBars}
	if len(touches) == 0 {
		check.Note = "no historical trendline touches available"
		return check
	}
	reactionUp := trendlineReactionSource(data, "up", line.Basis)
	reactionDown := trendlineReactionSource(data, "down", line.Basis)

	lastSampleIndex := -1
	for _, touchIndex := range touches {
		if touchIndex >= len(data.Close)-1 {
			continue
		}
		end := minInt(len(data.Close)-1, touchIndex+windowBars)
		if end <= touchIndex {
			continue
		}
		atrValue := latestATRAt(atr, touchIndex, math.Abs(line.ProjectedPrice)*0.005)
		reactionThreshold := math.Max(atrValue*0.35, math.Abs(line.ProjectedPrice)*0.0025)
		breakThreshold := math.Max(atrValue*0.25, math.Abs(line.ProjectedPrice)*0.0015)
		outcome := "unresolved"
		for index := touchIndex + 1; index <= end; index++ {
			linePrice := trendlinePriceAt(index, line.Slope, line.Intercept, line.Scale)
			if line.Kind == "support" {
				if data.Close[index] < linePrice-breakThreshold {
					outcome = "broken"
					break
				}
				if reactionUp[index] >= linePrice+reactionThreshold {
					outcome = "respected"
					break
				}
				continue
			}
			if data.Close[index] > linePrice+breakThreshold {
				outcome = "broken"
				break
			}
			if reactionDown[index] <= linePrice-reactionThreshold {
				outcome = "respected"
				break
			}
		}
		check.SampleCount++
		lastSampleIndex = touchIndex
		switch outcome {
		case "respected":
			check.Respected++
		case "broken":
			check.Broken++
		default:
			check.Unresolved++
		}
	}

	return finalizeStructureCheck(data, check, lastSampleIndex)
}

func finalizeStructureCheck(data *series, check structureCheck, lastSampleIndex int) structureCheck {
	if check.SampleCount == 0 {
		check.Note = "not enough completed samples in lookahead window"
		return check
	}
	check.RespectRate = roundTo(float64(check.Respected)/float64(check.SampleCount), 4)
	check.BreakRate = roundTo(float64(check.Broken)/float64(check.SampleCount), 4)
	if lastSampleIndex >= 0 && lastSampleIndex < len(data.Dates) {
		check.LastSampleTime = data.Dates[lastSampleIndex].Format(time.RFC3339)
	}
	return check
}
