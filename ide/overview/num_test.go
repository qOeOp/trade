package main

import "testing"

func TestNumReadsWhatNumberAcceptsAndNothingElse(t *testing.T) {
	wantNumber(t, num(1.5), 1.5)
	wantNumber(t, num("1.5"), 1.5)
	wantNumber(t, num(" 12 "), 12)
	wantNumber(t, num("1e3"), 1000)
	wantNumber(t, num(" "), 0) // Number(" ") is 0; only "" is none
	for _, v := range []any{"", "abc", "Infinity", "nan", "inf", "0x1p-2", "1_000", "1e999", nil, true, []any{}, obj{}} {
		wantNil(t, num(v))
	}
	if got := num("-0.000"); got == nil || *got != 0 || 1/(*got) < 0 {
		t.Errorf("negative zero is written as zero: %v", deref(got))
	}
}

func TestShapesThatDoNotFitNeverPanic(t *testing.T) {
	wantEqual(t, field("text", "a", "b"), nil)
	wantEqual(t, item(obj{}, 0), nil)
	wantEqual(t, item([]any{1.0, 2.0}, -1), 2.0)
	wantEqual(t, item([]any{}, -1), nil)
	if _, err := rows(obj{"code": -1.0}); err == nil {
		t.Error("an object is no list")
	}
	if _, err := rows(nil); err == nil {
		t.Error("nothing is no list")
	}
	if l, err := optional(nil); l != nil || err != nil {
		t.Error("a missing list is empty")
	}
	if _, err := optional("text"); err == nil {
		t.Error("something else is no list")
	}
}

func TestTrimAndLengthAreJavaScripts(t *testing.T) {
	wantEqual(t, trim("\u3000\ufeff a \u00a0\n"), "a")
	wantEqual(t, trim("\u0085a"), "\u0085a")
	wantEqual(t, length("币安人生"), 4)
}
