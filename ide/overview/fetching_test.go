package main

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func answer(status int, body string, headers map[string]string) *http.Response {
	h := http.Header{}
	for k, v := range headers {
		h.Set(k, v)
	}
	return &http.Response{StatusCode: status, Header: h, Body: io.NopCloser(strings.NewReader(body))}
}

func testHost(now *int64, weightCap int, send func(*http.Request) (*http.Response, error)) *Host {
	return &Host{base: "https://api.example", send: send, now: func() int64 { return *now }, weightCap: weightCap, minute: -1}
}

func TestA429Or418PausesEveryRequestToThatHostForItsRetryAfterAtLeastAMinute(t *testing.T) {
	var now int64
	calls := 0
	answers := []*http.Response{answer(418, "", map[string]string{"Retry-After": "120"}), answer(200, `{"ok":1}`, nil)}
	host := testHost(&now, 0, func(*http.Request) (*http.Response, error) {
		calls++
		next := answers[0]
		answers = answers[1:]
		return next, nil
	})
	var refused *HTTPError
	if _, err := host.json("/a"); !errors.As(err, &refused) || refused.Status != 418 {
		t.Fatalf("%v", err)
	}
	wantEqual(t, refused.Message, "https://api.example answered 418, paused 120 s")
	wantEqual(t, host.wait(), 120*time.Second)
	_, err := host.json("/b")
	if err == nil || err.Error() != "https://api.example paused for 120 s" {
		t.Fatalf("%v", err)
	}
	wantEqual(t, calls, 1) // the paused request never left
	now = 120_000
	body, err := host.json("/b")
	if err != nil {
		t.Fatal(err)
	}
	wantEqual(t, body, any(obj{"ok": 1.0}))

	quick := testHost(new(int64), 0, func(*http.Request) (*http.Response, error) { return answer(429, "", nil), nil })
	if _, err := quick.json("/c"); err == nil {
		t.Error("a 429 is a failure")
	}
	wantEqual(t, quick.wait(), time.Minute)
}

func TestARequestNamesThisService(t *testing.T) {
	var sent string
	host := testHost(new(int64), 0, func(r *http.Request) (*http.Response, error) {
		sent = r.Header.Get("User-Agent")
		return answer(200, `{}`, nil), nil
	})
	if _, err := host.json("/a"); err != nil {
		t.Fatal(err)
	}
	wantEqual(t, sent, "trade-overview")
}

func TestAnAnswerThatIsNoSuccessNamesThePathWithoutItsQuery(t *testing.T) {
	host := testHost(new(int64), 0, func(*http.Request) (*http.Response, error) { return answer(503, "", nil), nil })
	_, err := host.json("/a/b?secretless=1")
	if err == nil || err.Error() != "https://api.example/a/b answered 503" {
		t.Fatalf("%v", err)
	}
	wantEqual(t, host.wait(), time.Duration(0))
}

func TestAHostWithAWeightCapWaitsForTheNextMinuteOnceTheWeightReachesTheCap(t *testing.T) {
	now := int64(59_950) // 50 ms before the minute turns
	weighed := func(used string) func(*http.Request) (*http.Response, error) {
		return func(*http.Request) (*http.Response, error) {
			return answer(200, "{}", map[string]string{"X-Mbx-Used-Weight-1m": used}), nil
		}
	}
	timed := func(host *Host) time.Duration {
		started := time.Now()
		if _, err := host.json("/x"); err != nil {
			t.Fatal(err)
		}
		return time.Since(started)
	}
	capped := testHost(&now, 600, weighed("600"))
	timed(capped)
	if took := timed(capped); took < 40*time.Millisecond {
		t.Errorf("did not wait: %v", took)
	}
	under := testHost(&now, 600, weighed("599"))
	timed(under)
	if took := timed(under); took >= 40*time.Millisecond {
		t.Errorf("waited under the cap: %v", took)
	}
}

func TestAQueryIsPostedAsJSONWithoutOneTheRequestIsAPlainGET(t *testing.T) {
	type sent struct{ method, body, contentType string }
	var seen []sent
	host := testHost(new(int64), 0, func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		seen = append(seen, sent{r.Method, string(body), r.Header.Get("Content-Type")})
		return answer(200, "{}", nil), nil
	})
	if _, err := host.query("/info", map[string]string{"type": "metaAndAssetCtxs"}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.json("/tickers"); err != nil {
		t.Fatal(err)
	}
	wantEqual(t, seen[0], sent{"POST", `{"type":"metaAndAssetCtxs"}`, "application/json"})
	wantEqual(t, seen[1], sent{"GET", "", ""})
}
