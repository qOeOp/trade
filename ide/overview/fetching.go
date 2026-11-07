package main

// Requests to one public host: JSON over GET with a timeout (or, for a host whose market data answers only
// POST, a read-only query posted as JSON), a feed's text, and a pause the host itself asks for. A 429
// (too many requests) or 418 (Binance's ban after ignoring 429s) pauses every request to that host for
// its Retry-After, at least a minute, so one source cannot get the others refused. A host with a weight
// cap (Binance's) also waits for the next minute once the weight it reports used this minute reaches the
// cap: the paper daemon and the market import call Binance from the same address and keep the rest.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
)

// HTTPError is a host's refusal or failure, with its status.
type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return e.Message }

const (
	requestTimeout = 20 * time.Second
	minPauseS      = 60.0
	minuteMS       = int64(60_000)
	// userAgent names this service on every request and socket. The Block's feed refuses Go's default.
	userAgent = "trade-overview"
)

var requests = &http.Client{Timeout: requestTimeout}

// Host is one public host. `send` and `now` (milliseconds) are the network and the clock.
type Host struct {
	base      string
	send      func(*http.Request) (*http.Response, error)
	now       func() int64
	weightCap int

	mu          sync.Mutex
	pausedUntil int64
	used        float64
	minute      int64
}

func wallClock() int64 { return time.Now().UnixMilli() }

func newHost(base string, weightCap int) *Host {
	return &Host{base: base, send: requests.Do, now: wallClock, weightCap: weightCap, minute: -1}
}

// wait is how long until requests may go again, 0 when they may now.
func (h *Host) wait() time.Duration {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.waitLocked()
}

func (h *Host) waitLocked() time.Duration {
	return time.Duration(max(0, h.pausedUntil-h.now())) * time.Millisecond
}

// json GETs `path`.
func (h *Host) json(path string) (any, error) {
	return decoded(h.request(path, http.MethodGet, nil, "application/json"))
}

// query POSTs `query` to `path` as JSON.
func (h *Host) query(path string, query any) (any, error) {
	body, err := json.Marshal(query)
	if err != nil {
		return nil, err
	}
	return decoded(h.request(path, http.MethodPost, body, "application/json"))
}

func decoded(body []byte, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	var v any
	if err := json.Unmarshal(bytes.TrimPrefix(body, []byte("\xef\xbb\xbf")), &v); err != nil {
		return nil, err
	}
	return v, nil
}

// text GETs `path` as text: an RSS or Atom feed.
func (h *Host) text(path string) (string, error) {
	body, err := h.request(path, http.MethodGet, nil, "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9")
	if err != nil {
		return "", err
	}
	return strings.ToValidUTF8(string(body), "�"), nil
}

func (h *Host) request(path, method string, body []byte, accept string) ([]byte, error) {
	if err := h.mayGo(); err != nil {
		return nil, err
	}
	request, err := http.NewRequest(method, h.base+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", userAgent)
	request.Header.Set("Accept", accept)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := h.send(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if err := h.heed(response, path); err != nil {
		return nil, err
	}
	return io.ReadAll(response.Body)
}

// mayGo refuses a paused host, and waits out a minute whose weight has reached the cap.
func (h *Host) mayGo() error {
	h.mu.Lock()
	if left := h.waitLocked(); left > 0 {
		h.mu.Unlock()
		return &HTTPError{429, fmt.Sprintf("%s paused for %d s", h.base, int64(math.Ceil(left.Seconds())))}
	}
	now := h.now()
	var over time.Duration
	if h.weightCap > 0 && h.used >= float64(h.weightCap) && now/minuteMS == h.minute {
		over = time.Duration((h.minute+1)*minuteMS-now) * time.Millisecond
	}
	h.mu.Unlock()
	time.Sleep(over)
	return nil
}

// heed notes the weight the host reports and any pause it asks for, and fails an answer that is no success.
func (h *Host) heed(response *http.Response, path string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	if weight := num(response.Header.Get("X-Mbx-Used-Weight-1m")); weight != nil && *weight > 0 {
		h.used, h.minute = *weight, now/minuteMS
	}
	status := response.StatusCode
	if status == http.StatusTooManyRequests || status == http.StatusTeapot {
		seconds := minPauseS
		if asked := num(response.Header.Get("Retry-After")); asked != nil {
			seconds = math.Max(minPauseS, *asked)
		}
		h.pausedUntil = now + int64(seconds*1000)
		return &HTTPError{status, fmt.Sprintf("%s answered %d, paused %s s", h.base, status, plainNumber(seconds))}
	}
	if status < 200 || status > 299 {
		return &HTTPError{status, fmt.Sprintf("%s%s answered %d", h.base, strings.SplitN(path, "?", 2)[0], status)}
	}
	return nil
}
