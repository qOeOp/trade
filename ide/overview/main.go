// overview [--host=127.0.0.1] [--port=8768]
//
// The trade IDE's Market page data. `ide.py serve --overview=http://HOST:PORT` forwards the page's
// GET /api/overview/ requests here. It reads only free public endpoints, never with a credential, and with
// GET except Hyperliquid's read-only `info` query, which that host takes only as a POST:
//   - Binance: the contract list and funding periods hourly, quotes and funding every minute, and each
//     contract's open interest history and klines in a sweep every 15 minutes (the first in 8), its
//     long/short ratio every other sweep, all under a weight cap of its own;
//   - Bybit, OKX, Bitget, Gate and Hyperliquid: their whole-market tickers every 5 minutes, Bitget's and
//     Gate's contract details hourly;
//   - CoinGecko: coin ids every six hours, market caps every ten minutes and the sub-sectors' category
//     members once a day, one request per 25 s (its keyless limit);
//   - liquidations: Binance's, Bybit's and OKX's public pushes over WebSocket, held open, OKX's recent ones
//     by REST each hour for the contracts it pushed, and Gate's hourly stats of each listed coin each hour;
//   - news: Binance Square's news stream every two minutes, six RSS feeds every five; announcements of
//     Binance, Bybit, OKX and Bithumb every five minutes;
//   - the whole market: CoinGecko's totals with each round of market caps, the Fear & Greed Index and the
//     stablecoin supply hourly, Bitcoin's prices on Coinbase, Binance spot and Upbit (and Tether's on Kraken)
//     every minute, Deribit's Bitcoin options and DVOL every five, and once a day the daily klines of
//     Bitcoin and the 100 largest coins for the altcoin season index.
//
// Everything stays in memory; its numbers are no research evidence.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	geckoGap  = 25 * time.Second
	idsEvery  = 6 * time.Hour
	capsEvery = 10 * time.Minute
	members24 = 24 * time.Hour
	// binanceWeightCap is the weight a minute this service lets Binance count for this address: a quarter of
	// its 2400, since the paper daemon and the market import share the address.
	binanceWeightCap = 600
	// altseasonCoins is how many of the largest coins the altcoin season index compares with Bitcoin.
	altseasonCoins = 100
	spotBTC        = "/api/v3/ticker/price?symbol=BTCUSDT"
)

var (
	store       = newStore()
	binance     = newHost("https://fapi.binance.com", binanceWeightCap)
	coingecko   = newHost("https://api.coingecko.com/api/v3", 0)
	bybitHost   = newHost("https://api.bybit.com", 0)
	okxHost     = newHost("https://www.okx.com", 0)
	bitgetHost  = newHost("https://api.bitget.com", 0)
	gateHost    = newHost("https://api.gateio.ws", 0)
	hyperliquid = newHost("https://api.hyperliquid.xyz", 0)
	binanceWeb  = newHost("https://www.binance.com", 0)
	bithumb     = newHost("https://feed-api.bithumb.com", 0)
	alternative = newHost("https://api.alternative.me", 0)
	llama       = newHost("https://stablecoins.llama.fi", 0)
	coinbase    = newHost("https://api.exchange.coinbase.com", 0)
	binanceSpot = newHost("https://api.binance.com", 0)
	kraken      = newHost("https://api.kraken.com", 0)
	upbit       = newHost("https://api.upbit.com", 0)
	deribit     = newHost("https://www.deribit.com", 0)
)

// binanceAnnouncementCatalogues are its new listings, delistings, and its news (leverage, tiers, tick sizes).
var binanceAnnouncementCatalogues = []string{"48", "161", "49"}
var okxAnnouncementTypes = []string{"announcements-new-listings", "announcements-delistings", "announcements-trading-updates"}

// every runs a task at that pace, also waiting out any pause Binance asked for.
func every(period time.Duration, task func()) {
	go func() {
		for {
			started := time.Now()
			task()
			time.Sleep(max(period-time.Since(started), 0) + binance.wait())
		}
	}()
}

// into reads one body and, under the store's lock, puts what it held in place.
func into[T any](host *Host, path string, parse func(any) (T, error), apply func(T)) func() error {
	return func() error {
		body, err := host.json(path)
		if err != nil {
			return err
		}
		read, err := parse(body)
		if err != nil {
			return err
		}
		store.update(func() { apply(read) })
		return nil
	}
}

// got is a reading, or a failure for its kind when the body held none, so the last value stays.
func got[T any](value *T) (*T, error) {
	if value == nil {
		return nil, errors.New("the answer held no reading")
	}
	return value, nil
}

func binanceLists() {
	every(time.Hour, func() {
		store.refresh("contracts", into(binance, "/fapi/v1/exchangeInfo", contracts, func(v []Contract) { store.contracts = v }))
		store.refresh("funding", into(binance, "/fapi/v1/fundingInfo", fundingIntervals, func(v map[string]float64) { store.intervals = v }))
	})
	every(time.Minute, func() {
		store.refresh("quotes", into(binance, "/fapi/v1/ticker/24hr", quotes, func(v map[string]Quote) { store.quotes = v }))
		store.refresh("funding", into(binance, "/fapi/v1/premiumIndex", fundingRates, func(v map[string]float64) { store.funding = v }))
	})
}

func refreshContract(symbol string, round int) {
	s := url.QueryEscape(symbol)
	store.refresh("interest", into(binance, "/futures/data/openInterestHist?symbol="+s+"&period=5m&limit=289", interest, func(read *Interest) {
		if read != nil {
			store.interest[symbol] = *read
		}
	}))
	store.refresh("moves", func() error {
		five, err := binance.json("/fapi/v1/klines?symbol=" + s + "&interval=5m&limit=49")
		if err != nil {
			return err
		}
		hourly, err := binance.json("/fapi/v1/klines?symbol=" + s + "&interval=1h&limit=169")
		if err != nil {
			return err
		}
		read, line, err := moves(five, hourly)
		if err != nil {
			return err
		}
		store.update(func() { store.moves[symbol], store.lines[symbol] = read, line })
		return nil
	})
	if round%2 == 0 {
		store.refresh("ratios", into(binance, "/futures/data/globalLongShortAccountRatio?symbol="+s+"&period=5m&limit=1", longShort, func(ratio *float64) {
			if ratio != nil {
				store.ratios[symbol] = *ratio
			}
		}))
	}
}

// sweep takes each quoted contract in turn, spread over the sweep: two klines (weight 1 and 2) and one or two
// requests under /futures/data (1000 per 5 minutes an address), which for about 520 contracts comes to 104
// weight a minute and 260 of those requests per 5 minutes.
func sweep() {
	for round := 0; ; {
		started := time.Now()
		var list []string
		store.update(func() {
			for _, c := range store.contracts {
				if _, ok := store.quotes[c.Symbol]; ok {
					list = append(list, c.Symbol)
				}
			}
		})
		if len(list) == 0 {
			time.Sleep(5 * time.Second)
			continue
		}
		span := 15 * time.Minute
		if round == 0 {
			span = 8 * time.Minute
		}
		gap := span / time.Duration(len(list))
		for _, symbol := range list {
			at := time.Now()
			refreshContract(symbol, round)
			time.Sleep(max(gap-time.Since(at), 0) + binance.wait())
		}
		time.Sleep(max(span-time.Since(started), 0))
		round++
	}
}

// What the other exchanges' contract details give, for the loops that need them; the store's lock guards it.
var (
	bitgetContracts, gateContracts []any
	okxValues                      = map[string]float64{}
)

// The other exchanges: tickers every 5 minutes, after the contract details that give Bitget's and Gate's
// funding periods when those are an hour old or have not arrived.
func otherExchanges() {
	var contractsAt time.Time
	every(5*time.Minute, func() {
		var missing bool
		store.update(func() { missing = len(bitgetContracts) == 0 || len(gateContracts) == 0 || len(okxValues) == 0 })
		if time.Since(contractsAt) >= time.Hour || missing {
			contractsAt = time.Now()
			store.refresh("bitget", into(bitgetHost, "/api/v2/mix/market/contracts?productType=USDT-FUTURES", dataOf, func(v []any) { bitgetContracts = v }))
			store.refresh("gate", into(gateHost, "/api/v4/futures/usdt/contracts", rows, func(v []any) { gateContracts = v }))
			store.refresh("okx", into(okxHost, "/api/v5/public/instruments?instType=SWAP", okxContractValues, func(v map[string]float64) { okxValues = v }))
		}
		store.refresh("bybit", func() error {
			body, err := bybitHost.json("/v5/market/tickers?category=linear")
			if err != nil {
				return err
			}
			list, err := optional(field(body, "result", "list"))
			if err != nil {
				return err
			}
			markets := bybitMarkets(list)
			store.update(func() { store.venues["Bybit"] = markets })
			var symbols []string
			each(list, func(r obj) {
				if s, ok := str(r, "symbol"); ok && strings.HasSuffix(s, "USDT") {
					symbols = append(symbols, s)
				}
			})
			bybitStream.setSymbols(symbols)
			return nil
		})
		store.refresh("okx", func() error {
			interest, err := okxHost.json("/api/v5/public/open-interest?instType=SWAP")
			if err != nil {
				return err
			}
			funding, err := okxHost.json("/api/v5/public/funding-rate?instId=ANY")
			if err != nil {
				return err
			}
			oi, err := dataOf(interest)
			if err != nil {
				return err
			}
			rates, err := dataOf(funding)
			if err != nil {
				return err
			}
			markets := okxMarkets(oi, rates)
			store.update(func() { store.venues["OKX"] = markets })
			return nil
		})
		store.refresh("bitget", into(bitgetHost, "/api/v2/mix/market/tickers?productType=USDT-FUTURES", dataOf, func(v []any) { store.venues["Bitget"] = bitgetMarkets(v, bitgetContracts) }))
		store.refresh("gate", into(gateHost, "/api/v4/futures/usdt/tickers", rows, func(v []any) { store.venues["Gate"] = gateMarkets(v, gateContracts) }))
		store.refresh("hyperliquid", func() error {
			answer, err := hyperliquid.query("/info", map[string]string{"type": "metaAndAssetCtxs"})
			if err != nil {
				return err
			}
			markets := hyperliquidMarkets(answer)
			store.update(func() { store.venues["Hyperliquid"] = markets })
			return nil
		})
	})
}

func dataOf(body any) ([]any, error) { return optional(field(body, "data")) }

var (
	capsRead   bool // every page of market caps has been asked for once
	capsReadMu sync.Mutex
)

// gecko is one CoinGecko request at a time, at least geckoGap apart and after any pause CoinGecko asked for.
func gecko(kind string, read func() error) bool {
	time.Sleep(coingecko.wait())
	store.refresh(kind, read)
	time.Sleep(geckoGap)
	return store.succeeded(kind)
}

type memberPage struct {
	category string
	page     int
}

// Each ten minutes: the ids when due, the market caps, then category members in the time left over; a day's
// membership replaces the last only once every category has arrived.
func geckoRounds() {
	var idsAt, membersAt time.Time
	var queue []memberPage
	found := map[string]map[string]bool{}
	for {
		started := time.Now()
		var known int
		store.update(func() { known = len(store.ids) })
		if started.Sub(idsAt) >= idsEvery || known == 0 {
			gecko("ids", into(coingecko, "/derivatives/exchanges/binance_futures?include_tickers=unexpired", coinIDs, func(v map[string]string) { store.ids = v }))
			store.update(func() { known = len(store.ids) })
			if known > 0 {
				idsAt = started
			}
		}
		var wanted []string
		store.update(func() {
			for _, c := range store.contracts {
				if id, ok := store.ids[c.Symbol]; ok {
					wanted = append(wanted, id)
				}
			}
		})
		if len(wanted) == 0 { // the contract list has not arrived yet
			time.Sleep(5 * time.Second)
			continue
		}
		for _, page := range pages(wanted) { // each page shows as it arrives
			gecko("caps", into(coingecko, fmt.Sprintf("/coins/markets?vs_currency=usd&per_page=%d&ids=%s", geckoPage, strings.Join(page, ",")), caps, func(v map[string]Cap) {
				for id, read := range v {
					store.caps[id] = read
				}
			}))
		}
		capsReadMu.Lock()
		capsRead = true
		capsReadMu.Unlock()
		gecko("global", func() error {
			body, err := coingecko.json("/global")
			if err != nil {
				return err
			}
			store.update(func() { marketCap(body, &store.global) })
			return nil
		})
		if len(queue) == 0 && started.Sub(membersAt) >= members24 {
			queue = make([]memberPage, 0, len(categories))
			for _, category := range categories {
				queue = append(queue, memberPage{category, 1})
			}
			found = map[string]map[string]bool{}
		}
		for len(queue) > 0 && time.Since(started) < capsEvery-geckoGap {
			next := queue[0]
			arrived := gecko("members", func() error {
				body, err := coingecko.json(fmt.Sprintf("/coins/markets?vs_currency=usd&category=%s&per_page=%d&page=%d", next.category, geckoPage, next.page))
				if err != nil {
					return err
				}
				ids, err := members(body)
				if err != nil {
					return err
				}
				for _, id := range ids {
					if found[id] == nil {
						found[id] = map[string]bool{}
					}
					found[id][next.category] = true
				}
				if len(ids) == geckoPage && next.page == 1 { // the largest categories' second page
					queue = append(queue, memberPage{next.category, 2})
				}
				return nil
			})
			if !arrived { // asked again next round
				break
			}
			queue = queue[1:]
			if len(queue) == 0 {
				complete := found
				store.update(func() { store.categories = complete })
				membersAt = started
			}
		}
		time.Sleep(max(capsEvery-time.Since(started), 0))
	}
}

// pushes is what a stream does with its connection.
type pushes struct {
	open    func(*socket)
	ping    string
	message func(any)
}

// stream holds a connection open: it reconnects after a drop (5 s, doubling to a minute) and sends its host's
// keep-alive; a message marks its kind updated and a drop its error.
func stream(kind, url string, on pushes) {
	wait := 5 * time.Second
	for {
		code := closeAbnormal
		if conn, err := dial(url); err == nil {
			wait = 5 * time.Second
			code = hold(kind, conn, on)
		}
		store.update(func() { store.failed(kind, fmt.Sprintf("connection closed (%d), reconnecting", code)) })
		time.Sleep(wait)
		wait = min(wait*2, time.Minute)
	}
}

func hold(kind string, conn *socket, on pushes) int {
	defer conn.close()
	if on.open != nil {
		on.open(conn)
	}
	if on.ping != "" {
		done := make(chan struct{})
		defer close(done)
		go func() {
			ticker := time.NewTicker(20 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					_ = conn.send(on.ping)
				}
			}
		}()
	}
	for {
		text, code, err := conn.read()
		if err != nil {
			return code
		}
		var message any
		if json.Unmarshal([]byte(text), &message) != nil { // OKX answers its ping with a bare "pong"
			continue
		}
		store.update(func() { store.arrived(kind) })
		on.message(message)
	}
}

// bybitTopics takes a topic per contract, ten to a request.
type bybitTopics struct {
	mu      sync.Mutex
	symbols []string
	conn    *socket
	topics  map[string]bool
}

var bybitStream = &bybitTopics{}

func (b *bybitTopics) opened(conn *socket) {
	b.mu.Lock()
	b.conn, b.topics = conn, map[string]bool{}
	b.mu.Unlock()
	store.update(func() { store.liquidations.started("Bybit") })
	b.subscribe()
}

func (b *bybitTopics) setSymbols(symbols []string) {
	b.mu.Lock()
	b.symbols = symbols
	b.mu.Unlock()
	b.subscribe()
}

func (b *bybitTopics) subscribe() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.conn == nil || !b.conn.isOpen() {
		return
	}
	var fresh []string
	for _, s := range b.symbols {
		if topic := "allLiquidation." + s; !b.topics[topic] {
			fresh = append(fresh, topic)
		}
	}
	for i := 0; i < len(fresh); i += 10 {
		args, _ := json.Marshal(map[string]any{"op": "subscribe", "args": fresh[i:min(i+10, len(fresh))]})
		_ = b.conn.send(string(args))
	}
	for _, topic := range fresh {
		b.topics[topic] = true
	}
}

func liquidationStreams() {
	go stream("liquidations.binance", "wss://fstream.binance.com/market/ws/!forceOrder@arr", pushes{
		open:    func(*socket) { store.update(func() { store.liquidations.started("Binance") }) },
		message: func(m any) { read := fromBinance(m); store.update(func() { store.liquidations.add(read) }) },
	})
	go stream("liquidations.bybit", "wss://stream.bybit.com/v5/public/linear", pushes{
		open:    bybitStream.opened,
		ping:    `{"op":"ping"}`,
		message: func(m any) { read := fromBybit(m); store.update(func() { store.liquidations.add(read) }) },
	})
	go stream("liquidations.okx", "wss://ws.okx.com/ws/v5/public", pushes{
		open: func(conn *socket) {
			_ = conn.send(`{"op":"subscribe","args":[{"channel":"liquidation-orders","instType":"SWAP"}]}`)
			store.update(func() { store.liquidations.started("OKX") })
		},
		ping:    "ping",
		message: func(m any) { store.update(func() { store.liquidations.add(fromOKX(m, okxValues)) }) },
	})
}

// Each hour: OKX's recent liquidations of each contract it pushed one for in that hour (its pushes are
// throttled; repeats are dropped), then Gate's hourly stats of each Gate contract on a Binance coin, one
// request each 3 s.
func liquidationSweeps() {
	every(time.Hour, func() {
		from := float64(time.Now().UnixMilli()) - hourMS
		var pushed []string
		store.update(func() { pushed = store.liquidations.markets("OKX", from) })
		for _, id := range pushed {
			store.refresh("liquidations.okx", func() error {
				body, err := okxHost.json("/api/v5/public/liquidation-orders?instType=SWAP&uly=" + url.QueryEscape(strings.TrimSuffix(id, "-SWAP")) + "&state=filled&limit=100")
				if err != nil {
					return err
				}
				store.update(func() { store.liquidations.add(fromOKX(body, okxValues)) })
				return nil
			})
			time.Sleep(500 * time.Millisecond)
		}
		coins := map[string]bool{}
		var names []string
		for { // the lists arrive in the first minutes
			var ready bool
			store.update(func() {
				ready = len(gateContracts) > 0 && len(store.contracts) > 0
				if ready {
					for _, c := range store.contracts {
						coins[coinKey(c.Base)] = true
					}
					each(gateContracts, func(c obj) {
						if name, ok := str(c, "name"); ok && strings.HasSuffix(name, "_USDT") {
							names = append(names, name)
						}
					})
				}
			})
			if ready {
				break
			}
			time.Sleep(5 * time.Second)
		}
		for _, name := range names {
			coin := coinKey(strings.TrimSuffix(name, "_USDT"))
			if !coins[coin] {
				continue
			}
			store.refresh("liquidations.gate", func() error {
				body, err := gateHost.json("/api/v4/futures/usdt/contract_stats?contract=" + name + "&interval=1h&limit=25")
				if err != nil {
					return err
				}
				day, err := gateDay(body, float64(time.Now().UnixMilli()))
				if err != nil {
					return err
				}
				store.update(func() { store.gateLiquidations[coin] = day })
				return nil
			})
			time.Sleep(3 * time.Second)
		}
	})
}

func addHeadlines(read []Headline) { store.update(func() { store.headlines.add(read) }) }

// headlinesFrom reads one body of headlines into the record.
func headlinesFrom(host *Host, path string, parse func(any) ([]Headline, error)) error {
	body, err := host.json(path)
	if err != nil {
		return err
	}
	read, err := parse(body)
	if err != nil {
		return err
	}
	addHeadlines(read)
	return nil
}

func news() {
	every(2*time.Minute, func() {
		store.refresh("news.square", func() error {
			return headlinesFrom(binanceWeb, "/bapi/composite/v4/friendly/pgc/feed/news/list?pageIndex=1&pageSize=20&strategy=6&tagId=0&featured=false", square)
		})
	})
	hosts := make([]*Host, len(feeds))
	for i, f := range feeds {
		hosts[i] = newHost(f.Base, 0)
	}
	every(5*time.Minute, func() {
		// One feed failing keeps the others: the kind reports which failed.
		store.refresh("news.rss", func() error {
			var failed []string
			for i, f := range feeds {
				xml, err := hosts[i].text(f.Path)
				if err != nil {
					failed = append(failed, f.Source+": "+err.Error())
					continue
				}
				addHeadlines(feed(xml, f.Source))
			}
			if len(failed) > 0 {
				return errors.New(strings.Join(failed, "; "))
			}
			return nil
		})
		store.refresh("announcements.binance", func() error {
			for _, id := range binanceAnnouncementCatalogues {
				if err := headlinesFrom(binanceWeb, "/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20&catalogId="+id, binanceAnnouncements); err != nil {
					return err
				}
			}
			return nil
		})
		store.refresh("announcements.bybit", func() error {
			for _, kind := range []string{"new_crypto", "delistings"} {
				if err := headlinesFrom(bybitHost, "/v5/announcements/index?locale=en-US&type="+kind+"&limit=20", bybitAnnouncements); err != nil {
					return err
				}
			}
			return nil
		})
		store.refresh("announcements.okx", func() error {
			for _, kind := range okxAnnouncementTypes {
				if err := headlinesFrom(okxHost, "/api/v5/support/announcements?annType="+kind, okxAnnouncements); err != nil {
					return err
				}
			}
			return nil
		})
		store.refresh("announcements.bithumb", func() error {
			return headlinesFrom(bithumb, "/v1/notices?page=1", func(body any) ([]Headline, error) { return bithumbNotices(body), nil })
		})
	})
}

func wholeMarket() {
	every(time.Hour, func() {
		store.refresh("fearGreed", into(alternative, "/fng/?limit=1", func(body any) (*FearGreed, error) { return got(fearGreed(body)) }, func(v *FearGreed) { store.global.FearGreed = v }))
		store.refresh("stablecoins", into(llama, "/stablecoins?includePrices=false", func(body any) (*Stablecoins, error) {
			read, err := stablecoins(body)
			if err != nil {
				return nil, err
			}
			return got(read)
		}, func(v *Stablecoins) { store.global.Stablecoins = v }))
	})
	every(time.Minute, func() {
		store.refresh("premium.coinbase", func() error {
			usd, err := coinbase.json("/products/BTC-USD/ticker")
			if err != nil {
				return err
			}
			spot, err := binanceSpot.json(spotBTC)
			if err != nil {
				return err
			}
			tether, err := kraken.json("/0/public/Ticker?pair=USDTUSD")
			if err != nil {
				return err
			}
			read, err := got(coinbasePremium(usd, spot, tether))
			if err != nil {
				return err
			}
			store.update(func() { store.global.CoinbasePremium = read })
			return nil
		})
		store.refresh("premium.korea", func() error {
			korea, err := upbit.json("/v1/ticker?markets=KRW-BTC,KRW-USDT")
			if err != nil {
				return err
			}
			spot, err := binanceSpot.json(spotBTC)
			if err != nil {
				return err
			}
			premium, err := koreaPremium(korea, spot)
			if err != nil {
				return err
			}
			read, err := got(premium)
			if err != nil {
				return err
			}
			store.update(func() { store.global.KoreaPremium = read })
			return nil
		})
	})
	every(5*time.Minute, func() {
		store.refresh("options", into(deribit, "/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option", func(body any) (*Options, error) {
			read, err := bitcoinOptions(body)
			if err != nil {
				return nil, err
			}
			return got(read)
		}, func(v *Options) { store.global.Options = v }))
		now := time.Now().UnixMilli()
		path := fmt.Sprintf("/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=%d&end_timestamp=%d&resolution=3600", now-3*int64(hourMS), now)
		store.refresh("dvol", into(deribit, path, func(body any) (*float64, error) { return got(dvol(body)) }, func(v *float64) { store.global.DVOL = v }))
	})
}

// The altcoin season index once a day, retried hourly until a pass succeeds: Bitcoin's daily klines and those
// of the altseasonCoins largest other coins by market cap, once every page of caps has been read, one request
// each 2 s (weight 1 each).
func altseasonDaily() {
	var seasonAt time.Time
	daily := func(symbol string) (*float64, error) {
		klines, err := binance.json("/fapi/v1/klines?symbol=" + symbol + "&interval=1d&limit=" + strconv.Itoa(seasonDays+1))
		if err != nil {
			return nil, err
		}
		return seasonChange(klines)
	}
	every(time.Hour, func() {
		if time.Since(seasonAt) < 24*time.Hour {
			return
		}
		for {
			capsReadMu.Lock()
			ready := capsRead
			capsReadMu.Unlock()
			if ready {
				break
			}
			time.Sleep(time.Minute)
		}
		type sized struct {
			symbol string
			cap    float64
		}
		var largest []sized
		store.update(func() {
			for _, c := range store.contracts {
				if id, ok := store.ids[c.Symbol]; ok && c.Base != "BTC" {
					if m := store.caps[id].MarketCap; truthy(m) {
						largest = append(largest, sized{c.Symbol, *m})
					}
				}
			}
		})
		sort.SliceStable(largest, func(a, b int) bool { return largest[a].cap > largest[b].cap })
		largest = largest[:min(len(largest), altseasonCoins)]
		store.refresh("altseason", func() error {
			btc, err := daily("BTCUSDT")
			if err != nil {
				return err
			}
			changes := make([]*float64, 0, len(largest))
			for _, l := range largest {
				time.Sleep(2*time.Second + binance.wait())
				one, err := daily(url.QueryEscape(l.symbol))
				if err != nil {
					return err
				}
				changes = append(changes, one)
			}
			read, err := got(altseason(btc, changes))
			if err != nil {
				return err
			}
			store.update(func() { store.global.Altseason = read })
			seasonAt = time.Now()
			return nil
		})
	})
}

func main() {
	host := flag.String("host", "127.0.0.1", "address to listen on")
	port := flag.String("port", "8768", "port to listen on")
	flag.Parse()

	binanceLists()
	go sweep()
	otherExchanges()
	go geckoRounds()
	liquidationStreams()
	liquidationSweeps()
	news()
	wholeMarket()
	altseasonDaily()

	allowed := map[string]bool{*host + ":" + *port: true, "127.0.0.1:" + *port: true, "localhost:" + *port: true}
	log.SetFlags(0)
	log.Printf("trade IDE market overview at http://%s:%s/api/overview", *host, *port)
	log.Fatal(http.ListenAndServe(net.JoinHostPort(*host, *port), app(allowed, store)))
}
