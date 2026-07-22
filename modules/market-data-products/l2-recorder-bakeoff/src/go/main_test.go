package main

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestFrozenFixtures(t *testing.T) {
	for _, fixtureName := range []string{"complete", "gap"} {
		t.Run(fixtureName, func(t *testing.T) {
			raw, err := os.ReadFile("../../fixtures/" + fixtureName + ".json")
			if err != nil {
				t.Fatal(err)
			}
			fixture, err := parseFixture(raw)
			if err != nil {
				t.Fatal(err)
			}
			outcome, err := projectFixture(fixture)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(outcome, fixture.Expected) {
				actual, _ := json.Marshal(outcome)
				expected, _ := json.Marshal(fixture.Expected)
				t.Fatalf("outcome mismatch\nactual: %s\nexpected: %s", actual, expected)
			}
			result, err := runBakeoff(raw, 3)
			if err != nil {
				t.Fatal(err)
			}
			if result.ProcessedEventCount != fixture.Expected.AppliedEventCount*3 {
				t.Fatalf("unexpected processed event count: %d", result.ProcessedEventCount)
			}
		})
	}
}

func TestNormalizeDecimal(t *testing.T) {
	cases := map[string]string{"100.000": "100", "0.7500": "0.75", "7": "7"}
	for input, expected := range cases {
		actual, err := normalizeDecimal(input)
		if err != nil {
			t.Fatal(err)
		}
		if actual != expected {
			t.Fatalf("normalizeDecimal(%q) = %q, want %q", input, actual, expected)
		}
	}
	if _, err := normalizeDecimal("1e-8"); err == nil {
		t.Fatal("expected scientific notation to be rejected")
	}
}
