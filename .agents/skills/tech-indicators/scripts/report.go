package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func buildMarkdownReport(symbol, exchangeID string, results map[string]timeframeResult, summary map[string]string, selected []string) string {
	lines := []string{
		fmt.Sprintf("# %s Technical Analysis", symbol),
		"",
		fmt.Sprintf("- Exchange: `%s`", exchangeID),
		fmt.Sprintf("- Generated at: `%s`", time.Now().In(localTimezone).Format("2006-01-02 15:04:05 MST")),
		fmt.Sprintf("- Overall bias: `%s`", summary["bias"]),
		fmt.Sprintf("- Suggestion: %s", summary["suggestion"]),
		fmt.Sprintf("- Indicators run: `%d`", len(selected)),
		"",
		"Full indicator output in `analysis.json`.",
		"",
	}

	for _, timeframe := range timeframeOrder {
		result, ok := results[timeframe]
		if !ok {
			continue
		}
		core := result.CoreContext
		lines = append(lines,
			fmt.Sprintf("## %s", timeframe),
			"",
			fmt.Sprintf("- Trend: `%s`", result.Trend),
			fmt.Sprintf("- Price: `%v`", core["current_price"]),
			fmt.Sprintf("- EMA50 / EMA200: `%v` / `%v`", core["ema_50"], core["ema_200"]),
			fmt.Sprintf("- ATR14: `%v`", core["atr_14"]),
			fmt.Sprintf("- Range position: `%s`", result.PositionInRange),
			fmt.Sprintf("- Bullish invalidation: %s", result.BullishInvalidation),
			fmt.Sprintf("- Bearish invalidation: %s", result.BearishInvalidation),
			"",
			"### Indicators",
			"",
		)
		lines = append(lines, buildHighlightLines(result)...)
		lines = append(lines, "", "### Supports", "")
		if len(result.Supports) == 0 {
			lines = append(lines, "- no notable near-term support")
		} else {
			for _, level := range result.Supports {
				lines = append(lines, fmt.Sprintf(
					"- `%v-%v` (center `%v`) | touches=%d | strength=%s | cluster=%d | dist=%.2f%% | respect=%s",
					level.ZoneLow,
					level.ZoneHigh,
					level.Price,
					level.Touches,
					level.Strength,
					level.ClusterSize,
					level.DistanceFromPricePct*100,
					formatStructureCheck(level.Validation),
				))
			}
		}
		lines = append(lines, "", "### Resistances", "")
		if len(result.Resistances) == 0 {
			lines = append(lines, "- no notable near-term resistance")
		} else {
			for _, level := range result.Resistances {
				lines = append(lines, fmt.Sprintf(
					"- `%v-%v` (center `%v`) | touches=%d | strength=%s | cluster=%d | dist=%.2f%% | respect=%s",
					level.ZoneLow,
					level.ZoneHigh,
					level.Price,
					level.Touches,
					level.Strength,
					level.ClusterSize,
					level.DistanceFromPricePct*100,
					formatStructureCheck(level.Validation),
				))
			}
		}
		lines = append(lines, "", "### Trendlines", "")
		if len(result.Trendlines) == 0 {
			lines = append(lines, "- no active trendlines")
		} else {
			for _, line := range result.Trendlines {
				lines = append(lines, fmt.Sprintf(
					"- `%s` `%s/%s` line band `%v-%v` (center `%v`) | role=%s | break=%s | basis=%s/%s | confirm=%s | touches=%d | pivots=%d | span=%d bars | dist=%.2f%% | invalidation=%s | respect=%s",
					line.Kind,
					line.LineFamily,
					line.StructureRole,
					line.ProjectedLow,
					line.ProjectedHigh,
					line.ProjectedPrice,
					line.StructureRole,
					line.BreakMeaning,
					line.Basis,
					line.Scale,
					line.Confirmation,
					line.Touches,
					line.PivotTouches,
					line.SpanBars,
					line.DistanceFromPricePct*100,
					line.Invalidation,
					formatStructureCheck(line.Validation),
				))
			}
		}
		lines = append(lines, "", "### Walk-Forward Validation", "")
		if len(result.StructureValidation) == 0 {
			lines = append(lines, "- no walk-forward validation")
		} else {
			for _, key := range []string{"support", "resistance", "support_trendline_overall", "resistance_trendline_overall"} {
				check, ok := result.StructureValidation[key]
				if !ok {
					continue
				}
				lines = append(lines, fmt.Sprintf("- `%s`: %s", formatValidationLabel(key), formatValidationAggregate(check)))
			}
			for _, key := range orderedTrendlineVariantValidationKeys(result.StructureValidation) {
				check := result.StructureValidation[key]
				lines = append(lines, fmt.Sprintf("- `%s`: %s", formatValidationLabel(key), formatValidationAggregate(check)))
			}
		}
		lines = append(lines, "")
	}

	return strings.TrimSpace(strings.Join(lines, "\n")) + "\n"
}

func buildHighlightLines(result timeframeResult) []string {
	lines := []string{}
	for _, name := range highlightIndicatorNames {
		rawResult, ok := result.Indicators[name]
		if !ok {
			continue
		}
		indicatorResult, ok := rawResult.(map[string]any)
		if !ok || indicatorResult["status"] != "ok" {
			continue
		}
		encoded, _ := json.Marshal(indicatorResult["output"])
		lines = append(lines, fmt.Sprintf("- %s: `%s`", name, string(encoded)))
	}
	if len(lines) == 0 {
		lines = append(lines, "- key indicators not generated, see error fields in analysis.json")
	}
	return lines
}

func formatStructureCheck(check structureCheck) string {
	if check.SampleCount == 0 {
		if check.Note != "" {
			return check.Note
		}
		return "no completed samples"
	}
	base := fmt.Sprintf(
		"%d/%d respected (%.0f%%), %d broken, %d unresolved over %d bars",
		check.Respected,
		check.SampleCount,
		check.RespectRate*100,
		check.Broken,
		check.Unresolved,
		check.WindowBars,
	)
	if check.BreakoutSamples == 0 {
		return base
	}
	return fmt.Sprintf(
		"%s | breakouts=%d, rejected=%d, accepted=%d, avg outside=%.2f bars, outside closes=%.2f, max excursion=%.2f%%, avg return=%.2f bars",
		base,
		check.BreakoutSamples,
		check.RejectedBreakouts,
		check.AcceptedBreakouts,
		check.AvgBarsOutsideZone,
		check.AvgOutsideCloseCount,
		check.AvgMaxExcursionPct*100,
		check.AvgReturnToZoneBars,
	)
}

func formatValidationAggregate(check structureValidationAggregate) string {
	if check.SampleCount == 0 {
		if check.Note != "" {
			return check.Note
		}
		return "no completed samples"
	}
	base := fmt.Sprintf(
		"%d/%d respected (%.0f%%), %d broken, %d unresolved, avg distance %.2f%%, step=%d bars, window=%d bars",
		check.Respected,
		check.SampleCount,
		check.RespectRate*100,
		check.Broken,
		check.Unresolved,
		check.AvgDistanceFromPricePct*100,
		check.SampleStepBars,
		check.WindowBars,
	)
	if check.BreakoutSamples == 0 {
		return base
	}
	return fmt.Sprintf(
		"%s | breakouts=%d, rejected=%d, accepted=%d, avg outside=%.2f bars, outside closes=%.2f, max excursion=%.2f%%, avg return=%.2f bars",
		base,
		check.BreakoutSamples,
		check.RejectedBreakouts,
		check.AcceptedBreakouts,
		check.AvgBarsOutsideZone,
		check.AvgOutsideCloseCount,
		check.AvgMaxExcursionPct*100,
		check.AvgReturnToZoneBars,
	)
}

func formatValidationLabel(key string) string {
	switch key {
	case "support":
		return "support"
	case "resistance":
		return "resistance"
	case "support_trendline_overall":
		return "support trendline overall"
	case "resistance_trendline_overall":
		return "resistance trendline overall"
	}
	parts := strings.Split(key, "_")
	if len(parts) == 4 && parts[1] == "trendline" {
		return fmt.Sprintf("%s trendline %s/%s", parts[0], parts[2], parts[3])
	}
	return key
}

func orderedTrendlineVariantValidationKeys(values map[string]structureValidationAggregate) []string {
	keys := []string{}
	for _, kind := range []string{"support", "resistance"} {
		for _, basis := range []string{"wick", "close"} {
			for _, scale := range []string{"linear", "log"} {
				key := fmt.Sprintf("%s_trendline_%s_%s", kind, basis, scale)
				if _, ok := values[key]; ok {
					keys = append(keys, key)
				}
			}
		}
	}
	return keys
}
