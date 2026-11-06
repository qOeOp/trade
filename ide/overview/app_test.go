package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func call(t *testing.T, handler http.Handler, method, path, host string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	request.Host = host
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestHealthTheSnapshotACoinAndTheNewsAnswerGETOtherMethodsPathsAndHostsAreRefused(t *testing.T) {
	s := newStore()
	s.contracts = []Contract{{"BTCUSDT", "BTC", "PoW"}}
	const here = "127.0.0.1:8768"
	handler := app(map[string]bool{here: true}, s)
	get := func(path string) *httptest.ResponseRecorder { return call(t, handler, http.MethodGet, path, here) }

	wantEqual(t, get("/api/overview/health").Body.String(), `{"ok":true}`)
	var snapshot struct {
		Sectors []string
		Coins   []any
	}
	if err := json.Unmarshal(get("/api/overview/snapshot").Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	wantEqual(t, snapshot.Sectors[len(snapshot.Sectors)-1], "Other")
	wantEqual(t, snapshot.Coins, []any{}) // an empty list, not null
	coin := get("/api/overview/coin?symbol=BTCUSDT")
	wantEqual(t, coin.Code, 200)
	wantEqual(t, coin.Body.String(), `{"symbol":"BTCUSDT","line":[],"venues":[{"venue":"Binance","oi":null,"funding":null,"intervalHours":8,"liquidations":null}]}`)
	unknown := get("/api/overview/coin?symbol=NOPE")
	wantEqual(t, unknown.Code, 404)
	wantEqual(t, unknown.Body.String(), `{"code":"UNKNOWN_SYMBOL","message":"no contract NOPE"}`)
	wantEqual(t, get("/api/overview/news").Body.String(), `{"items":[]}`)
	wantEqual(t, call(t, handler, http.MethodPost, "/api/overview/snapshot", here).Code, 405)
	elsewhere := get("/api/overview/elsewhere")
	wantEqual(t, elsewhere.Code, 404)
	wantEqual(t, elsewhere.Body.String(), `{"code":"NOT_FOUND","message":"/api/overview/elsewhere"}`)
	wantEqual(t, call(t, handler, http.MethodGet, "/api/overview/health", "evil.example:8768").Code, 403)
	wantEqual(t, call(t, handler, http.MethodPost, "/api/overview/health", "evil.example:8768").Code, 403) // the Host first
}

func TestAnAnswerCarriesTheHeadersThePageReliesOn(t *testing.T) {
	handler := app(map[string]bool{"here:1": true}, newStore())
	answer := call(t, handler, http.MethodGet, "/api/overview/health", "here:1")
	wantEqual(t, answer.Header().Get("Content-Type"), "application/json; charset=utf-8")
	wantEqual(t, answer.Header().Get("Cache-Control"), "no-store")
	wantEqual(t, answer.Header().Get("X-Content-Type-Options"), "nosniff")
	wantEqual(t, answer.Header().Get("Content-Length"), "11")
}

func TestTextIsWrittenAsJSONStringifyWritesIt(t *testing.T) {
	s := newStore()
	s.contracts = []Contract{{"BTCUSDT", "BTC", "PoW"}}
	s.headlines.add([]Headline{{"X", "news", "A & B <c> “d”", "https://x.test/?a=1&b=2", float64(wallClock()), []string{"BTC"}}})
	body := call(t, app(map[string]bool{"h": true}, s), http.MethodGet, "/api/overview/news", "h").Body.String()
	wantEqual(t, body[:len(`{"items":[{"source":"X","kind":"news","title":"A & B <c> “d”","link":"https://x.test/?a=1&b=2"`)], `{"items":[{"source":"X","kind":"news","title":"A & B <c> “d”","link":"https://x.test/?a=1&b=2"`)
}
