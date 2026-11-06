package main

import (
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

// What an endpoint's JSON holds, read as decoded into `any`, since each endpoint is only partly known and
// a field may arrive as a number or a numeric string. Nothing here panics on a shape it did not expect.
type obj = map[string]any

// of is a number that is present.
func of(f float64) *float64 { return &f }

// num is a finite number from an endpoint's number or numeric string; anything else is nil. A negative
// zero reads as zero: JSON answers carry no sign on it.
func num(v any) *float64 {
	switch t := v.(type) {
	case float64:
		return plain(t)
	case string:
		if t == "" {
			return nil
		}
		s := trim(t)
		if s == "" {
			return of(0)
		}
		if strings.ContainsAny(s, "xX_") {
			return nil
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return plain(f)
	}
	return nil
}

func plain(f float64) *float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	if f == 0 {
		return of(0)
	}
	return &f
}

// truthy is a number that is present and not zero.
func truthy(p *float64) bool { return p != nil && *p != 0 }

// finite drops what a product of two large numbers overflowed to.
func finite(f float64) *float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	return &f
}

// orZero is a number, or 0 without one.
func orZero(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func str(m obj, key string) (string, bool) {
	s, ok := m[key].(string)
	return s, ok
}

// text is a string field trimmed, or "" without one.
func text(v any) string {
	s, _ := v.(string)
	return trim(s)
}

// field walks into objects; anything missing on the way is nil.
func field(v any, keys ...string) any {
	for _, key := range keys {
		m, ok := v.(obj)
		if !ok {
			return nil
		}
		v = m[key]
	}
	return v
}

// item is a list's element, counted from the end when i is negative; nil when there is none.
func item(v any, i int) any {
	l, _ := v.([]any)
	if i < 0 {
		i += len(l)
	}
	if i < 0 || i >= len(l) {
		return nil
	}
	return l[i]
}

var errNotList = errors.New("the answer held no list where one belongs")

// rows is a body that must be a list: anything else fails its kind, whose last value stays.
func rows(v any) ([]any, error) {
	l, ok := v.([]any)
	if !ok {
		return nil, errNotList
	}
	return l, nil
}

// optional is a list that may be missing: empty then, and a failure only when something else is there.
func optional(v any) ([]any, error) {
	if v == nil {
		return nil, nil
	}
	return rows(v)
}

// each calls `use` on the list's objects.
func each(l []any, use func(obj)) {
	for _, r := range l {
		if m, ok := r.(obj); ok {
			use(m)
		}
	}
}

// trim drops what JavaScript's trim drops: Unicode spaces and the byte order mark, not U+0085.
func trim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
			return true
		}
		return r >= 0x2000 && r <= 0x200A
	})
}

// length counts a string as the exchanges' symbol rules were written: in UTF-16 units, for the contracts
// named in Chinese.
func length(s string) int { return len(utf16.Encode([]rune(s))) }

// plainNumber writes a number as text, for the keys that tell repeats apart.
func plainNumber(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// written is a field as the source wrote it, for the same keys.
func written(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return plainNumber(t)
	}
	return ""
}
