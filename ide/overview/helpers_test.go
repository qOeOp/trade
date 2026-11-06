package main

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// raw and fixture read testdata/: endpoints' answers as they were recorded.
func raw(t *testing.T, name string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func fixture(t *testing.T, name string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(raw(t, name)), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func list(t *testing.T, v any) []any {
	t.Helper()
	l, ok := v.([]any)
	if !ok {
		t.Fatalf("not a list: %v", v)
	}
	return l
}

func find(t *testing.T, rows []any, key, value string) obj {
	t.Helper()
	for _, r := range rows {
		if m, ok := r.(obj); ok && m[key] == value {
			return m
		}
	}
	t.Fatalf("no row with %s=%s", key, value)
	return nil
}

func number(t *testing.T, v any) float64 {
	t.Helper()
	p := num(v)
	if p == nil {
		t.Fatalf("not a number: %v", v)
	}
	return *p
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-6*math.Max(1, math.Abs(b)) }

func wantNear(t *testing.T, got *float64, want float64) {
	t.Helper()
	if got == nil || !near(*got, want) {
		t.Errorf("got %v, want %v", deref(got), want)
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func wantNumber(t *testing.T, got *float64, want float64) {
	t.Helper()
	if got == nil || *got != want {
		t.Errorf("got %v, want %v", deref(got), want)
	}
}

func wantNil(t *testing.T, got *float64) {
	t.Helper()
	if got != nil {
		t.Errorf("got %v, want none", *got)
	}
}

func wantEqual(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
}

// wantJSON compares an answer with the JSON it must write, key order included.
func wantJSON(t *testing.T, got any, want string) {
	t.Helper()
	body, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != want {
		t.Errorf("got  %s\nwant %s", body, want)
	}
}

func must[T any](t *testing.T) func(T, error) T {
	return func(v T, err error) T {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
}
