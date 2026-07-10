package main

import "testing"

func TestRoundPricePreservesLowPricedSymbols(t *testing.T) {
	tests := []struct {
		name string
		in   float64
		want float64
	}{
		{name: "major price keeps cents", in: 65000.12345, want: 65000.12},
		{name: "unit price keeps four decimals", in: 1.234567, want: 1.2346},
		{name: "cent price keeps six decimals", in: 0.01491159, want: 0.014912},
		{name: "sub cent price keeps eight decimals", in: 0.004321987, want: 0.00432199},
		{name: "tiny price keeps ten decimals", in: 0.00001234567, want: 0.0000123457},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := roundPrice(test.in)
			if got != test.want {
				t.Fatalf("roundPrice(%v) = %v, want %v", test.in, got, test.want)
			}
		})
	}
}

func TestFormatPriceDoesNotCollapseLowPrices(t *testing.T) {
	got := formatPrice(0.004321987)
	if got != "0.00432199" {
		t.Fatalf("formatPrice() = %q, want %q", got, "0.00432199")
	}
}
