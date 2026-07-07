package main

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

var indicatorImplementations = map[string]indicatorFunc{}

func registerIndicators() {
	indicatorImplementations["ema"] = indicatorEMA
	indicatorImplementations["sma"] = indicatorSMA
	indicatorImplementations["bollinger_bands"] = indicatorBollinger
	indicatorImplementations["supertrend"] = indicatorSupertrend
	indicatorImplementations["ichimoku"] = indicatorIchimoku
	indicatorImplementations["chaikin_money_flow"] = indicatorCMF
	indicatorImplementations["atr_percent"] = indicatorATRPercent
	indicatorImplementations["williams_percent"] = indicatorWilliams
	indicatorImplementations["dema"] = indicatorDEMA
	indicatorImplementations["tema"] = indicatorTEMA
	indicatorImplementations["vwma"] = indicatorVWMA
	indicatorImplementations["hull_moving_average"] = indicatorHMA
	indicatorImplementations["tv_wma"] = indicatorTVWMA
	indicatorImplementations["tv_hma"] = indicatorTVHMA
	indicatorImplementations["zema"] = indicatorDEMA
	indicatorImplementations["chopiness"] = indicatorChopiness
	indicatorImplementations["RMI"] = indicatorRMI
	indicatorImplementations["MADR"] = indicatorMADR
	indicatorImplementations["SSLChannels"] = indicatorSSLChannels
	indicatorImplementations["laguerre"] = indicatorLaguerre
	indicatorImplementations["osc"] = indicatorOSC
	indicatorImplementations["stc"] = indicatorSTC
	indicatorImplementations["fibonacci_retracements"] = indicatorFibonacci
	indicatorImplementations["td_sequential"] = indicatorTDSequential
	indicatorImplementations["VIDYA"] = indicatorVIDYA
	indicatorImplementations["PMAX"] = indicatorPMAX
	indicatorImplementations["vwmacd"] = indicatorVWMACD
	indicatorImplementations["mmar"] = indicatorMMAR
	indicatorImplementations["madrid_sqz"] = indicatorMadridSQZ
	indicatorImplementations["TKE"] = indicatorTKE
	indicatorImplementations["vpci"] = indicatorVPCI
	indicatorImplementations["vpcii"] = indicatorVPCII
	indicatorImplementations["vfi"] = indicatorVFI
	indicatorImplementations["tv_alma"] = indicatorALMA
	indicatorImplementations["tv_trama"] = indicatorTRAMA
	indicatorImplementations["gentrends"] = indicatorGentrends
	indicatorImplementations["segtrends"] = indicatorSegtrends
}

func computeIndicators(
	input *indicatorInput,
	selected []string,
	catalog map[string]catalogSpec,
	overrides map[string]map[string]any,
) map[string]any {
	type outcome struct {
		name   string
		result map[string]any
	}
	outcomes := make(chan outcome, len(selected))

	for _, name := range selected {
		go func(name string) {
			spec := catalog[name]
			params := copyAnyMap(spec.Defaults)
			for key, value := range overrides[name] {
				params[key] = value
			}
			result := map[string]any{
				"category": spec.Category,
				"params":   params,
			}
			impl, ok := indicatorImplementations[name]
			if !ok {
				result["status"] = "error"
				result["error"] = fmt.Sprintf("indicator not yet implemented in Go: %s", name)
				outcomes <- outcome{name: name, result: result}
				return
			}
			output, err := impl(input, params, spec)
			if err != nil {
				result["status"] = "error"
				result["error"] = err.Error()
			} else {
				result["status"] = "ok"
				result["output"] = output
			}
			outcomes <- outcome{name: name, result: result}
		}(name)
	}

	results := make(map[string]any, len(selected))
	for range len(selected) {
		o := <-outcomes
		results[o.name] = o.result
	}
	return results
}

func indicatorEMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 20)
	field := paramString(params, "field", "close")
	values := fieldValues(input.Series, field)
	return normalizeScalar(latestValid(emaSeries(values, period))), nil
}

func indicatorSMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 20)
	field := paramString(params, "field", "close")
	values := fieldValues(input.Series, field)
	return normalizeScalar(latestValid(smaSeries(values, period))), nil
}

func indicatorBollinger(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 20)
	stdv := paramFloat(params, "stdv", 2)
	field := paramString(params, "field", "close")
	values := fieldValues(input.Series, field)
	middle := smaSeries(values, period)
	std := rollingStd(values, period)
	lower := latestValidOffsetCombine(middle, std, func(m, s float64) float64 { return m - stdv*s })
	upper := latestValidOffsetCombine(middle, std, func(m, s float64) float64 { return m + stdv*s })
	return dataframeResult(map[string]any{
		"bb_lower":  lower,
		"bb_middle": latestValid(middle),
		"bb_upper":  upper,
	}), nil
}

func indicatorSupertrend(input *indicatorInput, params map[string]any, spec catalogSpec) (any, error) {
	period := paramInt(params, "period", 10)
	multiplier := paramFloat(params, "multiplier", 3)
	line, direction := supertrend(input.Series.High, input.Series.Low, input.Series.Close, period, multiplier)
	return sequenceResult(spec.OutputNames, []any{latestValid(line), direction}), nil
}

func indicatorIchimoku(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	conversion := paramInt(params, "conversion_line_period", 9)
	basePeriods := paramInt(params, "base_line_periods", 26)
	lagging := paramInt(params, "laggin_span", 52)
	displacement := paramInt(params, "displacement", 26)
	tenkan := midpointWindow(input.Series.High, input.Series.Low, conversion)
	kijun := midpointWindow(input.Series.High, input.Series.Low, basePeriods)
	spanA := combineSeries(tenkan, kijun, func(a, b float64) float64 { return (a + b) / 2 })
	spanB := midpointWindow(input.Series.High, input.Series.Low, lagging)
	leadingA := latestValid(spanA)
	leadingB := latestValid(spanB)
	shiftedA := shiftedLatest(spanA, displacement)
	shiftedB := shiftedLatest(spanB, displacement)
	return dictResult(map[string]any{
		"tenkan_sen":            latestValid(tenkan),
		"kijun_sen":             latestValid(kijun),
		"senkou_span_a":         shiftedA,
		"senkou_span_b":         shiftedB,
		"leading_senkou_span_a": leadingA,
		"leading_senkou_span_b": leadingB,
		"chikou_span":           input.Series.Close[len(input.Series.Close)-1],
		"cloud_green":           leadingA > leadingB,
		"cloud_red":             leadingA < leadingB,
	}), nil
}

func indicatorCMF(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 21)
	values := chaikinMoneyFlow(input.Series.High, input.Series.Low, input.Series.Close, input.Series.Volume, period)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorATRPercent(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 14)
	atrValues := atrSeries(input.Series.High, input.Series.Low, input.Series.Close, period)
	index := lastValidIndex(atrValues)
	if index < 0 {
		return nil, errors.New("cannot compute atr_percent")
	}
	return normalizeScalar((atrValues[index] / input.Series.Close[index]) * 100), nil
}

func indicatorWilliams(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 14)
	values := williamsPercent(input.Series.High, input.Series.Low, input.Series.Close, period)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorDEMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 20)
	field := paramString(params, "field", "close")
	values := fieldValues(input.Series, field)
	return normalizeScalar(latestValid(demaSeries(values, period))), nil
}

func indicatorTEMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 20)
	field := paramString(params, "field", "close")
	values := fieldValues(input.Series, field)
	return normalizeScalar(latestValid(temaSeries(values, period))), nil
}

func indicatorVWMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	window := paramInt(params, "window", 20)
	priceField := paramString(params, "price", "close")
	price := fieldValues(input.Series, priceField)
	return normalizeScalar(latestValid(vwmaSeries(price, input.Series.Volume, window))), nil
}

func indicatorHMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 20)
	field := paramString(params, "field", "close")
	return normalizeScalar(latestValid(hmaSeries(fieldValues(input.Series, field), period))), nil
}

func indicatorTVWMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	length := paramInt(params, "length", 9)
	field := paramString(params, "field", "close")
	return normalizeScalar(latestValid(wmaSeries(fieldValues(input.Series, field), length))), nil
}

func indicatorTVHMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	length := paramInt(params, "length", 16)
	field := paramString(params, "field", "close")
	return normalizeScalar(latestValid(hmaSeries(fieldValues(input.Series, field), length))), nil
}

func indicatorChopiness(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 14)
	values := chopinessSeries(input.Series.High, input.Series.Low, input.Series.Close, period)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorRMI(input *indicatorInput, _ map[string]any, _ catalogSpec) (any, error) {
	values := rmiSeries(input.Series.Close, 14, 5)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorMADR(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	length := paramInt(params, "length", 20)
	matype := paramString(params, "matype", "sma")
	var ma []float64
	if strings.EqualFold(matype, "ema") {
		ma = emaSeries(input.Series.Close, length)
	} else {
		ma = smaSeries(input.Series.Close, length)
	}
	index := lastValidIndex(ma)
	if index < 0 {
		return nil, errors.New("cannot compute MADR")
	}
	value := ((input.Series.Close[index] - ma[index]) / ma[index]) * 100
	return normalizeScalar(value), nil
}

func indicatorSSLChannels(input *indicatorInput, params map[string]any, spec catalogSpec) (any, error) {
	length := paramInt(params, "length", 10)
	mode := paramString(params, "mode", "sma")
	down, up := sslChannels(input.Series.High, input.Series.Low, input.Series.Close, length, mode)
	return sequenceResult(spec.OutputNames, []any{latestValid(down), latestValid(up)}), nil
}

func indicatorLaguerre(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	gamma := paramFloat(params, "gamma", 0.5)
	values := laguerreRSI(input.Series.Close, gamma)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorOSC(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "periods", 14)
	values := oscSeries(input.Series.Close, period)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorSTC(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	fast := paramInt(params, "fast", 23)
	slow := paramInt(params, "slow", 50)
	length := paramInt(params, "length", 10)
	values := stcSeries(input.Series.Close, fast, slow, length)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorFibonacci(input *indicatorInput, _ map[string]any, _ catalogSpec) (any, error) {
	high := maxSlice(input.Series.Close)
	low := minSlice(input.Series.Close)
	diff := high - low
	current := input.Series.Close[len(input.Series.Close)-1]
	return dictResult(map[string]any{
		"high":          high,
		"low":           low,
		"level_0.236":   high - diff*0.236,
		"level_0.382":   high - diff*0.382,
		"level_0.5":     high - diff*0.5,
		"level_0.618":   high - diff*0.618,
		"level_0.786":   high - diff*0.786,
		"current_price": current,
	}), nil
}

func indicatorTDSequential(input *indicatorInput, _ map[string]any, _ catalogSpec) (any, error) {
	buy, sell := tdSequential(input.Series.Close)
	return dictResult(map[string]any{"buy_setup": buy, "sell_setup": sell}), nil
}

func indicatorVIDYA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	length := paramInt(params, "length", 14)
	selectPeriod := paramInt(params, "select", 20)
	values := vidyaSeries(input.Series.Close, length, selectPeriod)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorPMAX(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	period := paramInt(params, "period", 10)
	length := paramInt(params, "length", 10)
	multiplier := paramFloat(params, "multiplier", 3)
	ma := emaSeries(input.Series.Close, length)
	atr := atrSeries(input.Series.High, input.Series.Low, input.Series.Close, period)
	line, direction := pmaxSeries(ma, atr, input.Series.Close, multiplier)
	return dictResult(map[string]any{"pmax": latestValid(line), "direction": direction}), nil
}

func indicatorVWMACD(input *indicatorInput, _ map[string]any, _ catalogSpec) (any, error) {
	fast := vwmaSeries(input.Series.Close, input.Series.Volume, 12)
	slow := vwmaSeries(input.Series.Close, input.Series.Volume, 26)
	macd := combineSeries(fast, slow, func(a, b float64) float64 { return a - b })
	signal := emaSeries(macd, 9)
	hist := combineSeries(macd, signal, func(a, b float64) float64 { return a - b })
	return dictResult(map[string]any{
		"macd":      latestValid(macd),
		"signal":    latestValid(signal),
		"histogram": latestValid(hist),
	}), nil
}

func indicatorMMAR(input *indicatorInput, params map[string]any, spec catalogSpec) (any, error) {
	matype := strings.ToLower(paramString(params, "matype", "ema"))
	periods := []int{5, 10, 20, 30, 40, 50, 60, 70, 80, 90}
	values := make([]any, 0, len(spec.OutputNames))
	current := input.Series.Close[len(input.Series.Close)-1]
	leadColor := "red"
	ma5 := averageTypeSeries(input.Series.Close, 5, matype)
	ma10 := averageTypeSeries(input.Series.Close, 10, matype)
	if latestValid(ma5) >= latestValid(ma10) && current >= latestValid(ma10) {
		leadColor = "lime"
	}
	values = append(values, leadColor)
	for _, period := range periods[1:] {
		ma := averageTypeSeries(input.Series.Close, period, matype)
		color := "red"
		last := latestValid(ma)
		prev := previousValid(ma)
		if current >= last && last >= prev {
			color = "lime"
		}
		values = append(values, color)
	}
	return sequenceResult(spec.OutputNames, values), nil
}

func indicatorMadridSQZ(input *indicatorInput, params map[string]any, spec catalogSpec) (any, error) {
	length := paramInt(params, "length", 14)
	cma := emaSeries(input.Series.Close, length)
	rma := rmaSeries(input.Series.Close, length)
	sma := smaSeries(input.Series.Close, length)
	current := input.Series.Close[len(input.Series.Close)-1]
	values := []any{
		colorByPosition(current, latestValid(cma), previousValid(cma), "aqua", "blue"),
		colorByPosition(current, latestValid(rma), previousValid(rma), "green", "red"),
		colorByPosition(current, latestValid(sma), previousValid(sma), "lime", "orange"),
	}
	return sequenceResult(spec.OutputNames, values), nil
}

func indicatorTKE(input *indicatorInput, _ map[string]any, spec catalogSpec) (any, error) {
	rsi := rsiSeries(input.Series.Close, 14)
	wpr := williamsPercent(input.Series.High, input.Series.Low, input.Series.Close, 14)
	stc := stcSeries(input.Series.Close, 23, 50, 10)
	composite := make([]float64, len(input.Series.Close))
	for i := range composite {
		values := []float64{}
		if isFinite(rsi[i]) {
			values = append(values, rsi[i])
		}
		if isFinite(wpr[i]) {
			values = append(values, 100+wpr[i])
		}
		if isFinite(stc[i]) {
			values = append(values, stc[i])
		}
		if len(values) == 0 {
			composite[i] = math.NaN()
			continue
		}
		composite[i] = average(values)
	}
	smooth := emaSeries(composite, 8)
	return sequenceResult(spec.OutputNames, []any{latestValid(composite), latestValid(smooth)}), nil
}

func indicatorVPCI(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	short := paramInt(params, "period_short", 5)
	long := paramInt(params, "period_long", 20)
	value := vpciSeries(input.Series.Close, input.Series.Volume, short, long)
	return normalizeScalar(latestValid(value)), nil
}

func indicatorVPCII(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	short := paramInt(params, "period_short", 5)
	long := paramInt(params, "period_long", 20)
	histPeriod := paramInt(params, "hist", 14)
	vpci := vpciSeries(input.Series.Close, input.Series.Volume, short, long)
	signal := smaSeries(vpci, histPeriod)
	hist := combineSeries(vpci, signal, func(a, b float64) float64 { return a - b })
	return dictResult(map[string]any{
		"vpci":      latestValid(vpci),
		"signal":    latestValid(signal),
		"histogram": latestValid(hist),
	}), nil
}

func indicatorVFI(input *indicatorInput, params map[string]any, spec catalogSpec) (any, error) {
	length := paramInt(params, "length", 130)
	signalLength := paramInt(params, "signalLength", 5)
	vfi := vfiSeries(input.Series.High, input.Series.Low, input.Series.Close, input.Series.Volume, length)
	signal := emaSeries(vfi, signalLength)
	hist := combineSeries(vfi, signal, func(a, b float64) float64 { return a - b })
	return sequenceResult(spec.OutputNames, []any{latestValid(vfi), latestValid(signal), latestValid(hist)}), nil
}

func indicatorALMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	length := paramInt(params, "length", 9)
	offset := paramFloat(params, "offset", 0.85)
	sigma := paramFloat(params, "sigma", 6)
	field := paramString(params, "field", "close")
	values := almaSeries(fieldValues(input.Series, field), length, offset, sigma)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorTRAMA(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	length := paramInt(params, "length", 99)
	field := paramString(params, "field", "close")
	values := tramaSeries(fieldValues(input.Series, field), length)
	return normalizeScalar(latestValid(values)), nil
}

func indicatorGentrends(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	field := paramString(params, "field", "close")
	values := fieldValues(input.Series, field)
	maxLine, minLine, err := gentrendsLines(values, paramFloat(params, "window", 1.0/3.0))
	if err != nil {
		return nil, err
	}
	return dataframeResult(map[string]any{
		"Data":     values[len(values)-1],
		"Max Line": maxLine[len(maxLine)-1],
		"Min Line": minLine[len(minLine)-1],
	}), nil
}

func indicatorSegtrends(input *indicatorInput, params map[string]any, _ catalogSpec) (any, error) {
	field := paramString(params, "field", "close")
	values := fieldValues(input.Series, field)
	maxLine, minLine, err := segtrendsLines(values, paramInt(params, "segments", 2))
	if err != nil {
		return nil, err
	}
	return dataframeResult(map[string]any{
		"Data":     values[len(values)-1],
		"Max Line": maxLine[len(maxLine)-1],
		"Min Line": minLine[len(minLine)-1],
	}), nil
}

func supertrend(high, low, close []float64, period int, multiplier float64) ([]float64, string) {
	atr := atrSeries(high, low, close, period)
	line := make([]float64, len(close))
	for i := range line {
		line[i] = math.NaN()
	}
	finalUpper := make([]float64, len(close))
	finalLower := make([]float64, len(close))
	direction := "down"
	for i := range close {
		if !isFinite(atr[i]) {
			continue
		}
		hl2 := (high[i] + low[i]) / 2
		basicUpper := hl2 + multiplier*atr[i]
		basicLower := hl2 - multiplier*atr[i]
		if i == 0 {
			finalUpper[i] = basicUpper
			finalLower[i] = basicLower
			line[i] = basicLower
			direction = "up"
			continue
		}
		if basicUpper < finalUpper[i-1] || close[i-1] > finalUpper[i-1] {
			finalUpper[i] = basicUpper
		} else {
			finalUpper[i] = finalUpper[i-1]
		}
		if basicLower > finalLower[i-1] || close[i-1] < finalLower[i-1] {
			finalLower[i] = basicLower
		} else {
			finalLower[i] = finalLower[i-1]
		}
		prevLine := line[i-1]
		if !isFinite(prevLine) || prevLine == finalUpper[i-1] {
			if close[i] <= finalUpper[i] {
				line[i] = finalUpper[i]
				direction = "down"
			} else {
				line[i] = finalLower[i]
				direction = "up"
			}
		} else {
			if close[i] >= finalLower[i] {
				line[i] = finalLower[i]
				direction = "up"
			} else {
				line[i] = finalUpper[i]
				direction = "down"
			}
		}
	}
	return line, direction
}

func sslChannels(high, low, close []float64, length int, mode string) ([]float64, []float64) {
	var highMA, lowMA []float64
	if strings.EqualFold(mode, "ema") {
		highMA = emaSeries(high, length)
		lowMA = emaSeries(low, length)
	} else {
		highMA = smaSeries(high, length)
		lowMA = smaSeries(low, length)
	}
	sslDown := make([]float64, len(close))
	sslUp := make([]float64, len(close))
	hlv := 0
	for i := range close {
		if close[i] > highMA[i] {
			hlv = 1
		} else if close[i] < lowMA[i] {
			hlv = -1
		}
		if hlv < 0 {
			sslDown[i] = highMA[i]
			sslUp[i] = lowMA[i]
		} else {
			sslDown[i] = lowMA[i]
			sslUp[i] = highMA[i]
		}
	}
	return sslDown, sslUp
}

func pmaxSeries(ma, atr, close []float64, multiplier float64) ([]float64, string) {
	line := make([]float64, len(close))
	for i := range line {
		line[i] = math.NaN()
	}
	direction := "short"
	longStop := make([]float64, len(close))
	shortStop := make([]float64, len(close))
	for i := range close {
		if !isFinite(ma[i]) || !isFinite(atr[i]) {
			continue
		}
		longStop[i] = ma[i] - multiplier*atr[i]
		shortStop[i] = ma[i] + multiplier*atr[i]
		if i == 0 {
			line[i] = longStop[i]
			direction = "long"
			continue
		}
		if ma[i] > shortStop[i-1] {
			direction = "long"
		} else if ma[i] < longStop[i-1] {
			direction = "short"
		}
		if direction == "long" {
			longStop[i] = math.Max(longStop[i], longStop[i-1])
			line[i] = longStop[i]
		} else {
			shortStop[i] = math.Min(shortStop[i], shortStop[i-1])
			line[i] = shortStop[i]
		}
	}
	return line, direction
}

func vpciSeries(close, volume []float64, short, long int) []float64 {
	smaShort := smaSeries(close, short)
	smaLong := smaSeries(close, long)
	vwmaShort := vwmaSeries(close, volume, short)
	vwmaLong := vwmaSeries(close, volume, long)
	volShort := smaSeries(volume, short)
	volLong := smaSeries(volume, long)
	out := make([]float64, len(close))
	for i := range out {
		if !isFinite(smaShort[i]) || !isFinite(smaLong[i]) || !isFinite(vwmaShort[i]) || !isFinite(vwmaLong[i]) || !isFinite(volShort[i]) || !isFinite(volLong[i]) || smaShort[i] == 0 || volLong[i] == 0 {
			out[i] = math.NaN()
			continue
		}
		vpc := vwmaLong[i] - smaLong[i]
		vpr := vwmaShort[i] / smaShort[i]
		vm := volShort[i] / volLong[i]
		out[i] = vpc * vpr * vm
	}
	return out
}

func vfiSeries(high, low, close, volume []float64, length int) []float64 {
	typical := make([]float64, len(close))
	for i := range typical {
		typical[i] = (high[i] + low[i] + close[i]) / 3
	}
	moneyFlow := make([]float64, len(close))
	for i := 1; i < len(close); i++ {
		if typical[i] > typical[i-1] {
			moneyFlow[i] = volume[i]
		} else if typical[i] < typical[i-1] {
			moneyFlow[i] = -volume[i]
		}
	}
	flowSum := rollingSum(moneyFlow, length)
	volAvg := smaSeries(volume, length)
	out := make([]float64, len(close))
	for i := range out {
		if !isFinite(flowSum[i]) || !isFinite(volAvg[i]) || volAvg[i] == 0 {
			out[i] = math.NaN()
			continue
		}
		out[i] = flowSum[i] / (volAvg[i] * float64(length))
	}
	return out
}

func laguerreRSI(close []float64, gamma float64) []float64 {
	out := make([]float64, len(close))
	l0, l1, l2, l3 := 0.0, 0.0, 0.0, 0.0
	for i, price := range close {
		l0New := (1-gamma)*price + gamma*l0
		l1New := -gamma*l0New + l0 + gamma*l1
		l2New := -gamma*l1New + l1 + gamma*l2
		l3New := -gamma*l2New + l2 + gamma*l3
		cu := 0.0
		cd := 0.0
		if l0New >= l1New {
			cu += l0New - l1New
		} else {
			cd += l1New - l0New
		}
		if l1New >= l2New {
			cu += l1New - l2New
		} else {
			cd += l2New - l1New
		}
		if l2New >= l3New {
			cu += l2New - l3New
		} else {
			cd += l3New - l2New
		}
		if cu+cd == 0 {
			out[i] = math.NaN()
		} else {
			out[i] = cu / (cu + cd)
		}
		l0, l1, l2, l3 = l0New, l1New, l2New, l3New
	}
	return out
}

func oscSeries(close []float64, periods int) []float64 {
	out := make([]float64, len(close))
	for i := range close {
		if i < periods {
			out[i] = math.NaN()
			continue
		}
		up := 0.0
		down := 0.0
		for j := i - periods + 1; j <= i; j++ {
			delta := close[j] - close[j-1]
			if delta >= 0 {
				up += delta
			} else {
				down += -delta
			}
		}
		total := up + down
		if total == 0 {
			out[i] = 0.5
		} else {
			out[i] = up / total
		}
	}
	return out
}

func stcSeries(close []float64, fast, slow, length int) []float64 {
	macdLine, _, _ := macdSeries(close, fast, slow, 9)
	lowest := rollingMin(macdLine, length)
	highest := rollingMax(macdLine, length)
	stoch := make([]float64, len(close))
	for i := range close {
		if !isFinite(macdLine[i]) || !isFinite(lowest[i]) || !isFinite(highest[i]) || highest[i] == lowest[i] {
			stoch[i] = math.NaN()
			continue
		}
		stoch[i] = ((macdLine[i] - lowest[i]) / (highest[i] - lowest[i])) * 100
	}
	return emaSeries(stoch, 3)
}

func rmiSeries(close []float64, length, momentum int) []float64 {
	mom := make([]float64, len(close))
	for i := range close {
		if i < momentum {
			mom[i] = math.NaN()
			continue
		}
		mom[i] = close[i] - close[i-momentum]
	}
	gains := make([]float64, len(close))
	losses := make([]float64, len(close))
	for i, value := range mom {
		if !isFinite(value) {
			gains[i], losses[i] = math.NaN(), math.NaN()
			continue
		}
		if value > 0 {
			gains[i] = value
		}
		if value < 0 {
			losses[i] = -value
		}
	}
	avgGain := rmaSeries(gains, length)
	avgLoss := rmaSeries(losses, length)
	out := make([]float64, len(close))
	for i := range out {
		if !isFinite(avgGain[i]) || !isFinite(avgLoss[i]) {
			out[i] = math.NaN()
			continue
		}
		if avgLoss[i] == 0 {
			out[i] = 100
		} else {
			rs := avgGain[i] / avgLoss[i]
			out[i] = 100 - (100 / (1 + rs))
		}
	}
	return out
}

func rsiSeries(close []float64, period int) []float64 {
	gains := make([]float64, len(close))
	losses := make([]float64, len(close))
	for i := 1; i < len(close); i++ {
		delta := close[i] - close[i-1]
		if delta > 0 {
			gains[i] = delta
		} else if delta < 0 {
			losses[i] = -delta
		}
	}
	avgGain := rmaSeries(gains, period)
	avgLoss := rmaSeries(losses, period)
	out := make([]float64, len(close))
	for i := range out {
		if !isFinite(avgGain[i]) || !isFinite(avgLoss[i]) {
			out[i] = math.NaN()
			continue
		}
		if avgLoss[i] == 0 {
			out[i] = 100
			continue
		}
		rs := avgGain[i] / avgLoss[i]
		out[i] = 100 - (100 / (1 + rs))
	}
	return out
}

func chopinessSeries(high, low, close []float64, period int) []float64 {
	tr := trueRangeSeries(high, low, close)
	trSum := rollingSum(tr, period)
	highest := rollingMax(high, period)
	lowest := rollingMin(low, period)
	out := make([]float64, len(close))
	for i := range out {
		denom := highest[i] - lowest[i]
		if !isFinite(trSum[i]) || !isFinite(highest[i]) || !isFinite(lowest[i]) || denom <= 0 {
			out[i] = math.NaN()
			continue
		}
		out[i] = 100 * math.Log10(trSum[i]/denom) / math.Log10(float64(period))
	}
	return out
}

func williamsPercent(high, low, close []float64, period int) []float64 {
	highest := rollingMax(high, period)
	lowest := rollingMin(low, period)
	out := make([]float64, len(close))
	for i := range out {
		denom := highest[i] - lowest[i]
		if !isFinite(highest[i]) || !isFinite(lowest[i]) || denom == 0 {
			out[i] = math.NaN()
			continue
		}
		out[i] = ((highest[i] - close[i]) / denom) * -100
	}
	return out
}

func chaikinMoneyFlow(high, low, close, volume []float64, period int) []float64 {
	flowVolume := make([]float64, len(close))
	for i := range close {
		denom := high[i] - low[i]
		if denom == 0 {
			flowVolume[i] = 0
			continue
		}
		multiplier := ((close[i] - low[i]) - (high[i] - close[i])) / denom
		flowVolume[i] = multiplier * volume[i]
	}
	flowSum := rollingSum(flowVolume, period)
	volumeSum := rollingSum(volume, period)
	out := make([]float64, len(close))
	for i := range out {
		if !isFinite(flowSum[i]) || !isFinite(volumeSum[i]) || volumeSum[i] == 0 {
			out[i] = math.NaN()
			continue
		}
		out[i] = flowSum[i] / volumeSum[i]
	}
	return out
}

func tdSequential(close []float64) (int, int) {
	buy, sell := 0, 0
	for i := 4; i < len(close); i++ {
		if close[i] < close[i-4] {
			buy++
			sell = 0
		} else if close[i] > close[i-4] {
			sell++
			buy = 0
		} else {
			buy, sell = 0, 0
		}
		if buy > 9 {
			buy = 9
		}
		if sell > 9 {
			sell = 9
		}
	}
	return buy, sell
}

func vidyaSeries(close []float64, length, selectPeriod int) []float64 {
	cmo := cmoSeries(close, selectPeriod)
	alpha := 2.0 / (float64(length) + 1)
	out := make([]float64, len(close))
	for i := range out {
		if i == 0 {
			out[i] = close[i]
			continue
		}
		weight := alpha
		if isFinite(cmo[i]) {
			weight = alpha * math.Abs(cmo[i]/100)
		}
		out[i] = weight*close[i] + (1-weight)*out[i-1]
	}
	return out
}

func cmoSeries(close []float64, period int) []float64 {
	out := make([]float64, len(close))
	for i := range close {
		if i < period {
			out[i] = math.NaN()
			continue
		}
		sumUp := 0.0
		sumDown := 0.0
		for j := i - period + 1; j <= i; j++ {
			delta := close[j] - close[j-1]
			if delta > 0 {
				sumUp += delta
			} else {
				sumDown += -delta
			}
		}
		total := sumUp + sumDown
		if total == 0 {
			out[i] = 0
		} else {
			out[i] = ((sumUp - sumDown) / total) * 100
		}
	}
	return out
}

func almaSeries(values []float64, length int, offset, sigma float64) []float64 {
	out := make([]float64, len(values))
	m := offset * float64(length-1)
	s := float64(length) / sigma
	for i := range values {
		if i < length-1 {
			out[i] = math.NaN()
			continue
		}
		sumWeights := 0.0
		sumValues := 0.0
		for j := 0; j < length; j++ {
			weight := math.Exp(-math.Pow(float64(j)-m, 2) / (2 * math.Pow(s, 2)))
			sumWeights += weight
			sumValues += values[i-length+1+j] * weight
		}
		out[i] = sumValues / sumWeights
	}
	return out
}

func tramaSeries(values []float64, length int) []float64 {
	short := emaSeries(values, maxInt(2, length/3))
	long := emaSeries(values, length)
	cmo := cmoSeries(values, maxInt(2, length/5))
	out := make([]float64, len(values))
	for i := range values {
		if i == 0 {
			out[i] = values[i]
			continue
		}
		alpha := 2.0 / (float64(length) + 1)
		if isFinite(cmo[i]) {
			alpha = alpha * (0.5 + math.Abs(cmo[i])/200)
		}
		basis := values[i]
		if isFinite(short[i]) && isFinite(long[i]) {
			basis = (short[i] + long[i]) / 2
		}
		out[i] = alpha*basis + (1-alpha)*out[i-1]
	}
	return out
}

func gentrendsLines(values []float64, window float64) ([]float64, []float64, error) {
	if len(values) < 3 {
		return nil, nil, errors.New("gentrends requires at least 3 data points")
	}
	windowSize := int(window)
	if window < 1 {
		windowSize = int(window * float64(len(values)))
	}
	if windowSize <= 0 {
		return nil, nil, errors.New("gentrends window too small")
	}
	max1 := firstIndexOfValue(values, maxSlice(values))
	min1 := firstIndexOfValue(values, minSlice(values))
	if max1 < 0 || min1 < 0 {
		return nil, nil, errors.New("gentrends cannot find primary extremum")
	}
	var max2Value float64
	if max1+windowSize >= len(values) {
		end := max1 - windowSize
		if end <= 0 {
			return nil, nil, errors.New("gentrends secondary high window insufficient")
		}
		max2Value = maxSlice(values[:end])
	} else {
		start := max1 + windowSize
		if start >= len(values) {
			return nil, nil, errors.New("gentrends secondary high window insufficient")
		}
		max2Value = maxSlice(values[start:])
	}
	var min2Value float64
	if min1-windowSize <= 0 {
		start := min1 + windowSize
		if start >= len(values) {
			return nil, nil, errors.New("gentrends secondary low window insufficient")
		}
		min2Value = minSlice(values[start:])
	} else {
		end := min1 - windowSize
		if end <= 0 {
			return nil, nil, errors.New("gentrends secondary low window insufficient")
		}
		min2Value = minSlice(values[:end])
	}
	max2 := firstIndexOfValue(values, max2Value)
	min2 := firstIndexOfValue(values, min2Value)
	if max2 < 0 || min2 < 0 || max1 == max2 || min1 == min2 {
		return nil, nil, errors.New("gentrends cannot locate secondary extremum")
	}
	maxSlope := (values[max1] - values[max2]) / float64(max1-max2)
	minSlope := (values[min1] - values[min2]) / float64(min1-min2)
	maxIntercept := values[max1] - maxSlope*float64(max1)
	minIntercept := values[min1] - minSlope*float64(min1)
	maxEnd := values[max1] + maxSlope*float64(len(values)-max1)
	minEnd := values[min1] + minSlope*float64(len(values)-min1)
	return linspace(maxIntercept, maxEnd, len(values)), linspace(minIntercept, minEnd, len(values)), nil
}

func segtrendsLines(values []float64, segments int) ([]float64, []float64, error) {
	if len(values) < 3 {
		return nil, nil, errors.New("segtrends requires at least 3 data points")
	}
	if segments < 2 {
		return nil, nil, errors.New("segtrends segments must be at least 2")
	}
	segsize := len(values) / segments
	if segsize <= 0 {
		return nil, nil, errors.New("segtrends segments too large")
	}
	maxima := make([]float64, segments)
	minima := make([]float64, segments)
	for i := 1; i <= segments; i++ {
		ind2 := i * segsize
		ind1 := ind2 - segsize
		maxima[i-1] = maxSlice(values[ind1:ind2])
		minima[i-1] = minSlice(values[ind1:ind2])
	}
	xMaxima := make([]int, segments)
	xMinima := make([]int, segments)
	for i := 0; i < segments; i++ {
		xMaxima[i] = firstIndexOfValue(values, maxima[i])
		xMinima[i] = firstIndexOfValue(values, minima[i])
	}
	var maxLine []float64
	var minLine []float64
	for i := 0; i < segments-1; i++ {
		if xMaxima[i+1] == xMaxima[i] || xMinima[i+1] == xMinima[i] {
			return nil, nil, errors.New("segtrends adjacent segment extrema overlap")
		}
		maxSlope := (maxima[i+1] - maxima[i]) / float64(xMaxima[i+1]-xMaxima[i])
		maxIntercept := maxima[i] - maxSlope*float64(xMaxima[i])
		maxEnd := maxima[i] + maxSlope*float64(len(values)-xMaxima[i])
		maxLine = linspace(maxIntercept, maxEnd, len(values))
		minSlope := (minima[i+1] - minima[i]) / float64(xMinima[i+1]-xMinima[i])
		minIntercept := minima[i] - minSlope*float64(xMinima[i])
		minEnd := minima[i] + minSlope*float64(len(values)-xMinima[i])
		minLine = linspace(minIntercept, minEnd, len(values))
	}
	return maxLine, minLine, nil
}

func averageTypeSeries(values []float64, period int, mode string) []float64 {
	if strings.EqualFold(mode, "ema") {
		return emaSeries(values, period)
	}
	return smaSeries(values, period)
}

func colorByPosition(current, level, previous float64, positive, negative string) string {
	if current >= level && level >= previous {
		return positive
	}
	return negative
}
