package main

import (
	"testing"
	"time"
)

func parsed(t *testing.T, layout, value string) float64 {
	t.Helper()
	when, err := time.Parse(layout, value)
	if err != nil {
		t.Fatal(err)
	}
	return float64(when.UnixMilli())
}

func TestRSSAndAtomTitleOutOfCDATATheLinkWithoutTrackingThePublicationTime(t *testing.T) {
	etfs := feed(raw(t, "rssCoindesk.xml"), "CoinDesk")[0]
	wantEqual(t, etfs, Headline{"CoinDesk", "news", "Bitcoin ETFs lost $643 million in outflows Friday, and 2026 is barely green now",
		"https://www.coindesk.com/markets/2026/11/02/bitcoin-etfs-lost-usd643-million-in-outflows-friday-and-2026-is-barely-green-now",
		parsed(t, time.RFC1123Z, "Mon, 02 Nov 2026 06:46:41 +0000"), nil})
	wantEqual(t, feed(raw(t, "rssCointelegraph.xml"), "Cointelegraph")[0].Link, "https://cointelegraph.com/news/btcpay-server-hot-wallet-thefts-older-versions")
	wantEqual(t, feed(raw(t, "rssOdaily.xml"), "Odaily")[1].Title, "1.49亿美元SOL存入多家交易所，某巨鲸10天内存入149万枚")
	atom := feed(raw(t, "atomBlockworks.xml"), "Blockworks")[0] // the alternate link, not the enclosure
	wantEqual(t, atom.Link, "https://blockworks.com/news/venezuelas-sanctions-stablecoins")
	wantEqual(t, atom.At, parsed(t, time.RFC3339, "2026-01-07T14:00:00.000Z"))
	wantEqual(t, len(feed("<rss><channel><item><title>No link</title></item></channel></rss>", "X")), 0)
	wantEqual(t, feed("<rss><item><title>A &amp; B &#8217;s</title><link>https://x.test/a</link><pubDate>Mon, 02 Nov 2026 06:46:41 +0000</pubDate></item></rss>", "X")[0].Title, "A & B ’s")
}

func TestUntrackedDropsOnlyTrackingAndWritesTheLinkAsTheURLStandardDoes(t *testing.T) {
	for link, want := range map[string]string{
		"https://x.test/a?utm_source=rss&utm_medium=feed": "https://x.test/a",
		"https://x.test/a?id=1&utm_source=rss":            "https://x.test/a?id=1",
		"https://x.test/a?q=a%20b&utm_x=1":                "https://x.test/a?q=a+b",
		"https://x.test/a?q=a%20b":                        "https://x.test/a?q=a%20b",
		"https://x.test":                                  "https://x.test/",
		"https://X.Test:443/a":                            "https://x.test/a",
		"https://x.test/新闻/1":                             "https://x.test/%E6%96%B0%E9%97%BB/1",
		"not a link":                                      "not a link",
	} {
		wantEqual(t, untracked(link), want)
	}
}

func TestDatesAsFeedsWriteThem(t *testing.T) {
	want := parsed(t, time.RFC3339, "2026-11-02T06:46:41Z")
	for _, s := range []string{"Mon, 02 Nov 2026 06:46:41 +0000", "Mon, 2 Nov 2026 06:46:41 +0000", "Mon, 02 Nov 2026 06:46:41 GMT", "Mon, 02 Nov 2026 01:46:41 EST", "2026-11-02T06:46:41Z", "2026-11-02T06:46:41.000Z", "2026-11-02T14:46:41+08:00"} {
		wantNumber(t, parseDate(s), want)
	}
	wantNil(t, parseDate(""))
	wantNil(t, parseDate("soon"))
}

func TestBinanceSquareThePostsNamingATradingPairSecondsToMillisecondsThePairsCoins(t *testing.T) {
	read := must[[]Headline](t)(square(fixture(t, "binanceSquareNews.json")))
	wantEqual(t, len(read), 2) // Ryanair's costs name no pair
	wantEqual(t, read[0].Coins, []string{"SPCXB", "METAB"})
	wantEqual(t, []any{read[1].Link, read[1].At, read[1].Coins}, []any{"https://www.binance.com/en/square/post/383845750496711", 1793603541000.0, []string{"SOL"}})
}

func TestExchangeAnnouncementsBinancesLinkFromItsCodeBybitsPublicationTimeOKXs(t *testing.T) {
	listing := must[[]Headline](t)(binanceAnnouncements(fixture(t, "binanceAnnouncements.json")))[0]
	wantEqual(t, []any{listing.Kind, listing.Link, listing.At}, []any{"announcement", "https://www.binance.com/en/support/announcement/detail/a259777ee4104befa3daba5c1eadc7b5", 1793274532329.0})
	bybit := must[[]Headline](t)(bybitAnnouncements(fixture(t, "bybitAnnouncements.json")))
	wantEqual(t, []any{bybit[0].Title, bybit[0].At, bybit[1].Title, bybit[1].At}, []any{"Delisting of EPICUSDT Perpetual Contract", 1793178522000.0, "Delisting of MITOUSDT Perpetual Contract", 1793178525000.0})
	wantEqual(t, must[[]Headline](t)(okxAnnouncements(fixture(t, "okxAnnouncements.json")))[1].At, 1793332810651.0)
}

func TestBithumbOnlyTheNoticesNamingACoinInBracketsTheirTimeInKorea(t *testing.T) {
	notices := bithumbNotices(fixture(t, "bithumbNotices.json"))
	wantEqual(t, len(notices), 2) // the privacy notice names none
	wantEqual(t, notices[0].Coins, []string{"RECALL"})
	wantEqual(t, notices[1].Coins, []string{"BLUR", "CORE"})
	wantEqual(t, notices[0].At, parsed(t, time.RFC3339, "2026-10-30T22:30:00Z"))
}

func TestAHeadlineNamesTheListedCoinsByCodeByALargeCoinsNameOrByChineseNames(t *testing.T) {
	h := func(title string, coins ...string) Headline {
		return Headline{"X", "news", title, "https://x.test", 0, coins}
	}
	listed := map[string]bool{"BTC": true, "ETH": true, "SOL": true, "EPIC": true, "PEPE": true, "AI": true, "LINK": true}
	names := []coinName{{"Bitcoin", "BTC"}, {"Chainlink", "LINK"}}
	wantEqual(t, mentions(h("Whale Deposits 1.49 Million SOL"), listed, names), []string{"SOL"})
	wantEqual(t, mentions(h("Delisting of EPICUSDT Perpetual Contract"), listed, names), []string{"EPIC"})
	wantEqual(t, mentions(h("Bitcoin ETFs lost $643 million as Chainlink rallies"), listed, names), []string{"BTC", "LINK"})
	wantEqual(t, mentions(h("BTCPay Server warns of AI thefts"), listed, names), []string{}) // part of a word; a common acronym
	wantEqual(t, mentions(h("bitcoin, said in passing"), listed, names), []string{})         // names only as written
	wantEqual(t, mentions(h("比特币跌破7万美元，以太坊随之下跌"), listed, names), []string{"BTC", "ETH"})
	wantEqual(t, mentions(h("STOCKS | Tech", "SPCXB", "SOL"), listed, names), []string{"SOL"}) // the source's, if listed
}

func TestTheRecordKeepsEachLinkOnceForAWeekTheNewestAtMostLimit(t *testing.T) {
	const day = 86_400_000
	now := int64(parsed(t, time.RFC3339, "2026-11-02T08:00:00Z"))
	record := newHeadlines(func() int64 { return now }, 3)
	h := func(link string, at int64, title string) Headline {
		if title == "" {
			title = link
		}
		return Headline{"X", "news", title, link, float64(at), nil}
	}
	links := func() []string {
		var out []string
		for _, x := range record.list() {
			out = append(out, x.Link)
		}
		return out
	}
	record.add([]Headline{h("a", now-day, ""), h("a", now, "again"), h("b", now-8*day, ""), h("c", now-2*day, "")})
	wantEqual(t, links(), []string{"a", "c"})
	wantEqual(t, record.list()[0].Title, "a")
	record.add([]Headline{h("d", now, ""), h("e", now-3*day, "")})
	wantEqual(t, links(), []string{"d", "a", "c"})
	now += 6*day + 1 // "a" is now just over a week old
	record.add(nil)
	wantEqual(t, links(), []string{"d"})
}
