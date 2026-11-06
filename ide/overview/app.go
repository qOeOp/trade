package main

// The overview's HTTP interface, which `ide.py serve --overview` forwards the page's GETs to:
// GET /api/overview/health (whether the service is up), GET /api/overview/snapshot (every coin with its
// sector, quote, funding, open interest and market cap, and each kind of data's status) and
// GET /api/overview/coin?symbol= (one contract's seven-day line and its coin on each exchange) and
// GET /api/overview/news (the last week's headlines with the contracts each names). Nothing
// else exists: other methods are refused, as is a Host other than this service's own.

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

type refusal struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func send(w http.ResponseWriter, status int, body any) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(body); err != nil {
		log.Printf("cannot write an answer: %v", err)
		status, out = http.StatusInternalServerError, *bytes.NewBufferString(`{"code":"INTERNAL","message":"the answer could not be written"}` + "\n")
	}
	text := bytes.TrimSuffix(out.Bytes(), []byte("\n"))
	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Length", strconv.Itoa(len(text)))
	w.WriteHeader(status)
	_, _ = w.Write(text)
}

func app(hosts map[string]bool, store *Store) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.EscapedPath()
		switch {
		case !hosts[r.Host]:
			send(w, http.StatusForbidden, refusal{"FORBIDDEN", "requests come through the page's server"})
		case r.Method != http.MethodGet:
			send(w, http.StatusMethodNotAllowed, refusal{"METHOD_NOT_ALLOWED", "the overview only answers GET"})
		case path == "/api/overview/health":
			send(w, http.StatusOK, map[string]bool{"ok": true})
		case path == "/api/overview/snapshot":
			send(w, http.StatusOK, store.snapshot())
		case path == "/api/overview/news":
			send(w, http.StatusOK, map[string][]NewsItem{"items": store.news()})
		case path == "/api/overview/coin":
			symbol := r.URL.Query().Get("symbol")
			if coin := store.coin(symbol); coin != nil {
				send(w, http.StatusOK, coin)
			} else {
				send(w, http.StatusNotFound, refusal{"UNKNOWN_SYMBOL", "no contract " + symbol})
			}
		default:
			send(w, http.StatusNotFound, refusal{"NOT_FOUND", path})
		}
	})
}
