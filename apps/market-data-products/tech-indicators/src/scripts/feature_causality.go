package main

import (
	"fmt"
	"math"
	"time"
)

type featureCausalityMismatch struct {
	FactorID        string   `json:"factor_id"`
	CutoffIndex     int      `json:"cutoff_index"`
	CutoffTime      string   `json:"cutoff_time"`
	FullValue       *float64 `json:"full_value"`
	RecomputedValue *float64 `json:"recomputed_value"`
	Error           string   `json:"error,omitempty"`
}

type featureCausalityReport struct {
	Method                    string                     `json:"method"`
	Status                    string                     `json:"status"`
	Coverage                  string                     `json:"coverage"`
	EligibleCutoffs           int                        `json:"eligible_cutoffs"`
	CheckedCutoffs            int                        `json:"checked_cutoffs"`
	FactorCount               int                        `json:"factor_count"`
	ComparisonCount           int                        `json:"comparison_count"`
	MismatchCount             int                        `json:"mismatch_count"`
	MismatchExamplesTruncated bool                       `json:"mismatch_examples_truncated"`
	Mismatches                []featureCausalityMismatch `json:"mismatches"`
}

type factorFormulaComputer func(*indicatorInput, map[string]any, string) ([]float64, error)

type auditableFactor struct {
	id      string
	formula string
	params  map[string]any
	full    []float64
	err     error
}

func auditFeatureCausality(input *indicatorInput, selected []string, catalog map[string]catalogSpec, overrides map[string]map[string]any, maxCutoffs int, computer factorFormulaComputer) featureCausalityReport {
	factors := make([]auditableFactor, 0)
	for _, indicator := range selected {
		spec := catalog[indicator]
		params := copyAnyMap(spec.Defaults)
		for key, value := range overrides[indicator] {
			params[key] = value
		}
		for _, definition := range spec.Factors {
			values, err := computer(input, params, definition.Formula)
			factors = append(factors, auditableFactor{id: definition.ID, formula: definition.Formula, params: params, full: values, err: err})
		}
	}
	eligible := make([]int, 0, maxCausalityInt(0, len(input.Series.Close)-1))
	for index := 1; index < len(input.Series.Close); index++ {
		eligible = append(eligible, index)
	}
	cutoffs := boundedCausalityCutoffs(eligible, maxCutoffs)
	mismatches := make([]featureCausalityMismatch, 0)
	mismatchCount := 0
	comparisonCount := 0
	for _, cutoff := range cutoffs {
		prefix := prefixIndicatorInput(input, cutoff+1)
		for _, factor := range factors {
			comparisonCount++
			recomputed, err := computer(prefix, factor.params, factor.formula)
			if factor.err != nil || err != nil {
				mismatchCount++
				if len(mismatches) < 20 {
					mismatches = append(mismatches, featureCausalityMismatch{FactorID: factor.id, CutoffIndex: cutoff, CutoffTime: input.Series.Dates[cutoff].Format(time.RFC3339), Error: fmt.Sprintf("full=%v recomputed=%v", factor.err, err)})
				}
				continue
			}
			fullValue := seriesValue(factor.full, cutoff)
			recomputedValue := seriesValue(recomputed, cutoff)
			if sameReportedValue(fullValue, recomputedValue) {
				continue
			}
			mismatchCount++
			if len(mismatches) < 20 {
				mismatches = append(mismatches, featureCausalityMismatch{FactorID: factor.id, CutoffIndex: cutoff, CutoffTime: input.Series.Dates[cutoff].Format(time.RFC3339), FullValue: finitePointer(fullValue), RecomputedValue: finitePointer(recomputedValue)})
			}
		}
	}
	status := "passed"
	if mismatchCount > 0 {
		status = "failed"
	}
	coverage := "complete"
	if len(cutoffs) < len(eligible) {
		coverage = "sampled"
	}
	return featureCausalityReport{Method: "provider_prefix_recompute_v1", Status: status, Coverage: coverage, EligibleCutoffs: len(eligible), CheckedCutoffs: len(cutoffs), FactorCount: len(factors), ComparisonCount: comparisonCount, MismatchCount: mismatchCount, MismatchExamplesTruncated: mismatchCount > len(mismatches), Mismatches: mismatches}
}

func prefixIndicatorInput(input *indicatorInput, length int) *indicatorInput {
	data := input.Series
	prefix := &series{Dates: append([]time.Time(nil), data.Dates[:length]...), Open: append([]float64(nil), data.Open[:length]...), High: append([]float64(nil), data.High[:length]...), Low: append([]float64(nil), data.Low[:length]...), Close: append([]float64(nil), data.Close[:length]...), Volume: append([]float64(nil), data.Volume[:length]...)}
	return &indicatorInput{Timeframe: input.Timeframe, Series: prefix}
}

func boundedCausalityCutoffs(eligible []int, maximum int) []int {
	if maximum <= 0 || len(eligible) <= maximum {
		return append([]int(nil), eligible...)
	}
	result := make([]int, 0, maximum)
	previous := -1
	for index := 0; index < maximum; index++ {
		position := int(math.Round(float64(index) * float64(len(eligible)-1) / float64(maximum-1)))
		value := eligible[position]
		if value != previous {
			result = append(result, value)
			previous = value
		}
	}
	return result
}

func seriesValue(values []float64, index int) float64 {
	if index < 0 || index >= len(values) {
		return math.NaN()
	}
	return values[index]
}

func sameReportedValue(left, right float64) bool {
	if !isFinite(left) || !isFinite(right) {
		return !isFinite(left) && !isFinite(right)
	}
	return roundTo(left, 6) == roundTo(right, 6)
}

func finitePointer(value float64) *float64 {
	if !isFinite(value) {
		return nil
	}
	rounded := roundTo(value, 6)
	return &rounded
}

func maxCausalityInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
