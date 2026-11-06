package main

// News and exchange announcements: headlines only (title, source, time, link), never the article. News
// comes from six RSS feeds and Binance Square's news stream, of which only the posts naming a trading pair
// are kept (the rest is mostly general markets news); announcements
// from Binance's listing, delisting and news catalogues, Bybit's and OKX's listings and delistings, and
// Bithumb's notices (Korean listings), of which only those naming a coin are kept. Upbit's notices are not
// read: Cloudflare refuses this service's requests there (error 1015) whatever they say they are. A
// headline's coins are the ones its source names, and the listed coins its title names by code, or for the
// largest coins by name.

import (
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Headline is one headline: who published it, whether news or an exchange's announcement, its title and
// link, when (milliseconds), and the coins its source names (coin keys).
type Headline struct {
	Source, Kind, Title, Link string
	At                        float64
	Coins                     []string
}

// feedSource is one RSS feed.
type feedSource struct{ Source, Base, Path string }

// feeds are the RSS feeds read: English, then Chinese. Blockworks' feeds stopped in January 2026 and are not
// read.
var feeds = []feedSource{
	{"CoinDesk", "https://www.coindesk.com", "/arc/outboundfeeds/rss/"},
	{"Cointelegraph", "https://cointelegraph.com", "/rss"},
	{"The Block", "https://www.theblock.co", "/rss.xml"},
	{"Decrypt", "https://decrypt.co", "/feed"},
	{"Odaily", "https://rss.odaily.news", "/rss/newsflash"},
	{"PANews", "https://www.panewslab.com", "/rss.xml"},
}

var (
	cdata      = regexp.MustCompile(`(?s)<!\[CDATA\[(.*?)\]\]>`)
	reference  = regexp.MustCompile(`(?i)&(#x[0-9a-f]+|#\d+|[a-z]+);`)
	entities   = map[string]string{"amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " "}
	itemOpen   = regexp.MustCompile(`<(item|entry)(?:\s[^>]*)?>`)
	linkTag    = regexp.MustCompile(`<link\s([^>]*)/?>`)
	notAlt     = regexp.MustCompile(`rel="(enclosure|self)"`)
	hrefAttr   = regexp.MustCompile(`href="([^"]*)"`)
	httpLink   = regexp.MustCompile(`^https?://`)
	bracket    = regexp.MustCompile(`\(([A-Z0-9]{2,15})\)`)
	tradFiWord = regexp.MustCompile(`(?i)\bTradFi\b`)
)

var elements = func() map[string]*regexp.Regexp {
	out := map[string]*regexp.Regexp{}
	for _, tag := range []string{"title", "link", "pubDate", "published", "updated", "dc:date"} {
		out[tag] = regexp.MustCompile(`(?s)<` + tag + `(?:\s[^>]*)?>(.*?)</` + tag + `>`)
	}
	return out
}()

// unescape is an element's text: CDATA unwrapped, character references decoded.
func unescape(s string) string {
	s = cdata.ReplaceAllString(s, "$1")
	s = reference.ReplaceAllStringFunc(s, func(whole string) string {
		e := whole[1 : len(whole)-1]
		if e[0] != '#' {
			if to, ok := entities[strings.ToLower(e)]; ok {
				return to
			}
			return whole
		}
		base, digits := 10, e[1:]
		if digits[0] == 'x' || digits[0] == 'X' {
			base, digits = 16, digits[1:]
		}
		code, err := strconv.ParseInt(digits, base, 32)
		if err != nil {
			return whole
		}
		return string(rune(code))
	})
	return trim(s)
}

func element(xml, tag string) string {
	if m := elements[tag].FindStringSubmatch(xml); m != nil {
		return unescape(m[1])
	}
	return ""
}

// untracked is a link without its `utm_` tracking parameters, in the URL standard's writing: the empty path
// is `/`, and once a parameter is removed the others are form-encoded again.
func untracked(link string) string {
	u, err := url.Parse(strings.NewReplacer("\t", "", "\n", "", "\r", "").Replace(link))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return link
	}
	u.Host = strings.ToLower(u.Host)
	if u.Scheme == "https" {
		u.Host = strings.TrimSuffix(u.Host, ":443")
	}
	if u.Scheme == "http" {
		u.Host = strings.TrimSuffix(u.Host, ":80")
	}
	if u.Path == "" {
		u.Path = "/"
	}
	if u.RawQuery != "" {
		pairs := strings.Split(u.RawQuery, "&")
		kept := make([]string, 0, len(pairs))
		for _, pair := range pairs {
			key, value, _ := strings.Cut(pair, "=")
			name, err := url.QueryUnescape(key)
			if err != nil {
				name = key
			}
			if pair == "" || strings.HasPrefix(name, "utm_") {
				continue
			}
			decoded, err := url.QueryUnescape(value)
			if err != nil {
				decoded = value
			}
			kept = append(kept, formEncode(name)+"="+formEncode(decoded))
		}
		if len(kept) != len(pairs) {
			u.RawQuery = strings.Join(kept, "&")
		}
	}
	return u.String()
}

// formEncode differs from QueryEscape in the two characters the URL standard treats the other way.
func formEncode(s string) string {
	return strings.NewReplacer("~", "%7E", "%2A", "*").Replace(url.QueryEscape(s))
}

// A date as Date.parse takes those that feeds write: RFC 822 and its zone names, and ISO 8601.
var dateLayouts = []string{
	time.RFC1123Z, "Mon, 2 Jan 2006 15:04:05 -0700", time.RFC1123, "Mon, 2 Jan 2006 15:04:05 MST",
	"02 Jan 2006 15:04:05 -0700", "2 Jan 2006 15:04:05 -0700", "Mon, 02 Jan 2006 15:04 -0700", "Mon, 2 Jan 2006 15:04 -0700",
	time.RFC3339Nano, "2006-01-02T15:04Z07:00", "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02 15:04:05 -0700", time.DateOnly,
}
var zoneNames = strings.NewReplacer(" EST", " -0500", " EDT", " -0400", " CST", " -0600", " CDT", " -0500", " MST", " -0700", " MDT", " -0600", " PST", " -0800", " PDT", " -0700")

// parseDate is a time in milliseconds, nil for one it cannot read.
func parseDate(s string) *float64 {
	s = zoneNames.Replace(trim(s))
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return of(float64(t.UnixMilli()))
		}
	}
	return nil
}

func firstOf(xml string, tags ...string) string {
	for _, tag := range tags {
		if v := element(xml, tag); v != "" {
			return v
		}
	}
	return ""
}

// feed reads an RSS or Atom feed's items: title, link (an Atom entry's first link that is not an enclosure)
// and publication time; an item missing one is left out.
func feed(xml, source string) []Headline {
	var out []Headline
	for at := 0; at < len(xml); {
		m := itemOpen.FindStringSubmatchIndex(xml[at:])
		if m == nil {
			break
		}
		tag, start := xml[at+m[2]:at+m[3]], at+m[1]
		length := strings.Index(xml[start:], "</"+tag+">")
		if length < 0 {
			at += m[1]
			continue
		}
		if h, ok := feedItem(xml[start:start+length], source); ok {
			out = append(out, h)
		}
		at = start + length + len(tag) + 3
	}
	return out
}

func feedItem(body, source string) (Headline, bool) {
	link := element(body, "link")
	if link == "" {
		for _, m := range linkTag.FindAllStringSubmatch(body, -1) {
			if !notAlt.MatchString(m[1]) {
				if href := hrefAttr.FindStringSubmatch(m[1]); href != nil {
					link = unescape(href[1])
				}
				break
			}
		}
	}
	link = untracked(link)
	at, title := parseDate(firstOf(body, "pubDate", "published", "updated", "dc:date")), element(body, "title")
	if title == "" || !httpLink.MatchString(link) || at == nil {
		return Headline{}, false
	}
	return Headline{source, "news", title, link, *at, nil}, true
}

// square reads Binance Square's news stream (`/bapi/composite/v4/friendly/pgc/feed/news/list`): the posts
// naming a trading pair, with the pairs' coins; the time is in seconds.
func square(body any) ([]Headline, error) {
	list, err := optional(field(body, "data", "vos"))
	if err != nil {
		return nil, err
	}
	var out []Headline
	each(list, func(v obj) {
		at, title, link := num(v["date"]), text(v["title"]), text(v["webLink"])
		pairs, _ := v["tradingPairs"].([]any)
		var coins []string
		each(pairs, func(p obj) {
			if code, ok := str(p, "code"); ok {
				coins = append(coins, coinKey(code))
			}
		})
		if title != "" && link != "" && at != nil && len(coins) > 0 {
			out = append(out, Headline{"Binance Square", "news", title, link, *at * 1000, coins})
		}
	})
	return out, nil
}

// binanceAnnouncements reads a Binance announcement catalogue (`/bapi/composite/v1/public/cms/article/list/query`).
func binanceAnnouncements(body any) ([]Headline, error) {
	catalogs, err := optional(field(body, "data", "catalogs"))
	if err != nil {
		return nil, err
	}
	var out []Headline
	var failed error
	each(catalogs, func(c obj) {
		articles, err := optional(c["articles"])
		if err != nil {
			failed = err
		}
		each(articles, func(a obj) {
			at, title, code := num(a["releaseDate"]), text(a["title"]), text(a["code"])
			if title != "" && code != "" && at != nil {
				out = append(out, Headline{"Binance", "announcement", title, "https://www.binance.com/en/support/announcement/detail/" + code, *at, nil})
			}
		})
	})
	return out, failed
}

// bybitAnnouncements reads Bybit `GET /v5/announcements/index`.
func bybitAnnouncements(body any) ([]Headline, error) {
	list, err := optional(field(body, "result", "list"))
	if err != nil {
		return nil, err
	}
	var out []Headline
	each(list, func(a obj) {
		at := num(a["publishTime"])
		if at == nil {
			at = num(a["dateTimestamp"])
		}
		title, link := text(a["title"]), text(a["url"])
		if title != "" && link != "" && at != nil {
			out = append(out, Headline{"Bybit", "announcement", title, link, *at, nil})
		}
	})
	return out, nil
}

// okxAnnouncements reads OKX `GET /api/v5/support/announcements`.
func okxAnnouncements(body any) ([]Headline, error) {
	data, err := optional(field(body, "data"))
	if err != nil {
		return nil, err
	}
	var out []Headline
	var failed error
	each(data, func(d obj) {
		details, err := optional(d["details"])
		if err != nil {
			failed = err
		}
		each(details, func(a obj) {
			at, title, link := num(a["pTime"]), text(a["title"]), text(a["url"])
			if title != "" && link != "" && at != nil {
				out = append(out, Headline{"OKX", "announcement", title, link, *at, nil})
			}
		})
	})
	return out, failed
}

// bracketed is the codes a Bithumb notice names in brackets, as `블러(BLUR), 코어(CORE)`.
func bracketed(title string) []string {
	var out []string
	for _, m := range bracket.FindAllStringSubmatch(title, -1) {
		out = append(out, coinKey(m[1]))
	}
	return out
}

// bithumbNotices reads Bithumb's notices (`feed-api.bithumb.com/v1/notices`), those naming a coin; their
// times are Korean.
func bithumbNotices(body any) []Headline {
	list, _ := body.([]any)
	var out []Headline
	each(list, func(n obj) {
		at := parseDate(strings.Replace(text(n["published_at"]), " ", "T", 1) + "+09:00")
		title, link := text(n["title"]), text(n["pc_url"])
		coins := bracketed(title)
		if title != "" && httpLink.MatchString(link) && at != nil && len(coins) > 0 {
			out = append(out, Headline{"Bithumb", "announcement", title, link, *at, coins})
		}
	})
	return out
}

// tradFi is an exchange's announcement of its TradFi (stock and commodity) contracts, outside this page's
// coins.
func tradFi(h Headline) bool { return h.Kind == "announcement" && tradFiWord.MatchString(h.Title) }

// notCodes are upper-case words in headlines that are rarely a coin's code even when one is listed under them.
var notCodes = map[string]bool{"AI": true, "API": true, "ATH": true, "CEO": true, "CEX": true, "CFTC": true, "CPI": true, "DAO": true, "DEX": true, "ETF": true, "EU": true, "FBI": true, "FOMC": true, "GDP": true, "IPO": true, "IRS": true,
	"KYC": true, "NFT": true, "OK": true, "SEC": true, "TVL": true, "UK": true, "US": true, "USD": true, "UTC": true}

// chineseNames are the names of the two largest coins, which the Chinese feeds write instead of their codes.
var chineseNames = [][2]string{{"比特币", "BTC"}, {"以太坊", "ETH"}}

func letter(b byte) bool  { return b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z' }
func alnum(b byte) bool   { return letter(b) || b >= '0' && b <= '9' }
func isUpper(b byte) bool { return b >= 'A' && b <= 'Z' }

// codesIn is the words a title may name a coin's code with: whole runs of letters and digits, upper case,
// beginning with a letter, 2 to 15 long.
func codesIn(title string) []string {
	var out []string
	for i := 0; i < len(title); {
		if !alnum(title[i]) {
			i++
			continue
		}
		start, code := i, true
		for ; i < len(title) && alnum(title[i]); i++ {
			if !isUpper(title[i]) && !(title[i] >= '0' && title[i] <= '9') {
				code = false
			}
		}
		if code && isUpper(title[start]) && i-start >= 2 && i-start <= 15 {
			out = append(out, title[start:i])
		}
	}
	return out
}

// namedIn answers whether `name` stands in the title as a word of its own.
func namedIn(title, name string) bool {
	for from := 0; from <= len(title)-len(name) && name != ""; {
		at := strings.Index(title[from:], name)
		if at < 0 {
			return false
		}
		at += from
		end := at + len(name)
		if (at == 0 || !letter(title[at-1])) && (end == len(title) || !letter(title[end])) {
			return true
		}
		from = at + 1
	}
	return false
}

// coinName is a large coin's name and its coin key.
type coinName struct{ Name, Coin string }

// mentions is the listed coins a headline names: its source's, then the codes in its title (`SOL`,
// `BTCUSDT`), the `names` of the largest coins written as such (`Bitcoin`), and the Chinese names of BTC and
// ETH.
func mentions(h Headline, listed map[string]bool, names []coinName) []string {
	found := []string{}
	add := func(coin string) {
		if !slices.Contains(found, coin) {
			found = append(found, coin)
		}
	}
	for _, c := range h.Coins {
		if listed[c] {
			add(c)
		}
	}
	for _, word := range codesIn(h.Title) {
		bare := word
		for _, suffix := range []string{"USDT", "USDC", "PERP"} {
			if strings.HasSuffix(word, suffix) {
				bare = strings.TrimSuffix(word, suffix)
				break
			}
		}
		if bare == "" {
			bare = word
		}
		if code := coinKey(bare); !notCodes[code] && listed[code] {
			add(code)
		}
	}
	for _, n := range names {
		if namedIn(h.Title, n.Name) {
			add(n.Coin)
		}
	}
	for _, c := range chineseNames {
		if strings.Contains(h.Title, c[0]) && listed[c[1]] {
			add(c[1])
		}
	}
	return found
}

const weekMS = 7 * dayMS

// Headlines holds the headlines of the last week, each once by its link; at most `limit`, the newest kept.
// The store's lock guards it.
type Headlines struct {
	items []Headline
	now   func() int64
	limit int
}

func newHeadlines(now func() int64, limit int) *Headlines { return &Headlines{now: now, limit: limit} }

func (r *Headlines) add(list []Headline) {
	from := float64(r.now()) - weekMS
	seen := make(map[string]bool, len(r.items)+len(list))
	for _, h := range r.items {
		seen[h.Link] = true
	}
	for _, h := range list {
		if h.At >= from && !seen[h.Link] {
			seen[h.Link] = true
			r.items = append(r.items, h)
		}
	}
	kept := r.items[:0]
	for _, h := range r.items {
		if h.At >= from {
			kept = append(kept, h)
		}
	}
	sort.SliceStable(kept, func(a, b int) bool { return kept[a].At > kept[b].At })
	r.items = kept[:min(len(kept), r.limit)]
}

// list is the headlines, the newest first.
func (r *Headlines) list() []Headline { return r.items }
