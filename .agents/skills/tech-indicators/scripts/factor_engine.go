package main

import (
	"fmt"
	"math"
	"time"
)

var defaultFactorTransforms = []string{"level", "delta", "slope", "zscore", "percentile"}

func buildIndicatorFeatureSeries(input *indicatorInput, selected []string, catalog map[string]catalogSpec, overrides map[string]map[string]any) map[string]any {
	results := map[string]any{}
	for _, indicator := range selected {
		spec := catalog[indicator]
		params := copyAnyMap(spec.Defaults)
		for key, value := range overrides[indicator] {
			params[key] = value
		}
		if len(spec.Factors) == 0 {
			factorID := indicator + ".value"
			results[factorID] = factorResult(catalogFactorSpec{ID: factorID, Output: "value"}, indicator, spec.Category, params, "unsupported", nil, fmt.Sprintf("factor descriptor not declared: %s", indicator))
			continue
		}
		for _, definition := range spec.Factors {
			values, err := computeFactorFormula(input, params, definition.Formula)
			if err != nil {
				results[definition.ID] = factorResult(definition, indicator, spec.Category, params, "error", nil, err.Error())
				continue
			}
			results[definition.ID] = factorResult(definition, indicator, spec.Category, params, "ok", featurePoints(input.Series.Dates, values), "")
		}
	}
	return results
}

func computeFactorFormula(input *indicatorInput, params map[string]any, formula string) ([]float64, error) {
	switch formula {
	case "ema":
		return emaSeries(fieldValues(input.Series, paramString(params, "field", "close")), paramInt(params, "period", 20)), nil
	case "sma":
		return smaSeries(fieldValues(input.Series, paramString(params, "field", "close")), paramInt(params, "period", 20)), nil
	case "bollinger_middle":
		return smaSeries(fieldValues(input.Series, paramString(params, "field", "close")), paramInt(params, "period", 20)), nil
	case "bollinger_width_pct":
		values := fieldValues(input.Series, paramString(params, "field", "close"))
		middle := smaSeries(values, paramInt(params, "period", 20))
		std := rollingStd(values, paramInt(params, "period", 20))
		return combineSeries(middle, std, func(m, s float64) float64 {
			if m == 0 {
				return math.NaN()
			}
			return 2 * paramFloat(params, "stdv", 2) * s / m * 100
		}), nil
	case "chaikin_money_flow":
		return chaikinMoneyFlow(input.Series.High, input.Series.Low, input.Series.Close, input.Series.Volume, paramInt(params, "period", 21)), nil
	case "atr_percent":
		atr := atrSeries(input.Series.High, input.Series.Low, input.Series.Close, paramInt(params, "period", 14))
		return combineSeries(atr, input.Series.Close, func(a, close float64) float64 {
			if close == 0 {
				return math.NaN()
			}
			return a / close * 100
		}), nil
	case "williams_percent":
		return williamsPercent(input.Series.High, input.Series.Low, input.Series.Close, paramInt(params, "period", 14)), nil
	case "chopiness":
		return chopinessSeries(input.Series.High, input.Series.Low, input.Series.Close, paramInt(params, "period", 14)), nil
	case "laguerre":
		return laguerreRSI(input.Series.Close, paramFloat(params, "gamma", 0.5)), nil
	case "osc":
		return oscSeries(input.Series.Close, paramInt(params, "periods", 14)), nil
	case "stc":
		return stcSeries(input.Series.Close, paramInt(params, "fast", 23), paramInt(params, "slow", 50), paramInt(params, "length", 10)), nil
	case "vpci":
		return vpciSeries(input.Series.Close, input.Series.Volume, paramInt(params, "period_short", 5), paramInt(params, "period_long", 20)), nil
	case "vpcii_signal":
		value := vpciSeries(input.Series.Close, input.Series.Volume, paramInt(params, "period_short", 5), paramInt(params, "period_long", 20))
		return smaSeries(value, paramInt(params, "hist", 14)), nil
	case "vpcii_histogram":
		value := vpciSeries(input.Series.Close, input.Series.Volume, paramInt(params, "period_short", 5), paramInt(params, "period_long", 20))
		signal := smaSeries(value, paramInt(params, "hist", 14))
		return combineSeries(value, signal, func(a, b float64) float64 { return a - b }), nil
	case "vfi":
		return vfiSeries(input.Series.High, input.Series.Low, input.Series.Close, input.Series.Volume, paramInt(params, "length", 130)), nil
	case "vfi_signal":
		value := vfiSeries(input.Series.High, input.Series.Low, input.Series.Close, input.Series.Volume, paramInt(params, "length", 130))
		return emaSeries(value, paramInt(params, "signalLength", 5)), nil
	case "vfi_histogram":
		value := vfiSeries(input.Series.High, input.Series.Low, input.Series.Close, input.Series.Volume, paramInt(params, "length", 130))
		signal := emaSeries(value, paramInt(params, "signalLength", 5))
		return combineSeries(value, signal, func(a, b float64) float64 { return a - b }), nil
	default:
		return nil, fmt.Errorf("unknown factor formula primitive: %s", formula)
	}
}

func factorResult(definition catalogFactorSpec, indicator string, category string, params map[string]any, status string, values []map[string]any, errorMessage string) map[string]any {
	transforms := definition.AllowedTransforms
	if len(transforms) == 0 {
		transforms = defaultFactorTransforms
	}
	result := map[string]any{
		"factor_id": definition.ID, "source_indicator": indicator, "output": definition.Output,
		"category": category, "roles": definition.Roles, "allowed_transforms": transforms,
		"params": params, "status": status,
	}
	if definition.LegacyAlias != "" {
		result["legacy_alias"] = definition.LegacyAlias
	}
	if values != nil {
		result["values"] = values
	}
	if errorMessage != "" {
		result["error"] = errorMessage
	}
	return result
}

func featurePoints(dates []time.Time, values []float64) []map[string]any {
	points := []map[string]any{}
	for index, value := range values {
		if index >= len(dates) || !isFinite(value) {
			continue
		}
		points = append(points, map[string]any{"timestamp": dates[index].Format(time.RFC3339), "value": roundTo(value, 6)})
	}
	return points
}
