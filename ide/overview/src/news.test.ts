import assert from "node:assert/strict";
import { test } from "node:test";
import { binanceAnnouncements, bithumbNotices, bybitAnnouncements, feed, Headlines, mentions, okxAnnouncements, square, type Headline } from "./news.ts";
import { fixture, raw } from "./fixture.ts";

const DAY = 86_400_000;

test("RSS and Atom: title out of CDATA, the link without tracking, the publication time", () => {
  const [etfs] = feed(raw("rssCoindesk.xml"), "CoinDesk");
  assert.deepEqual(etfs, { source: "CoinDesk", kind: "news", title: "Bitcoin ETFs lost $643 million in outflows Friday, and 2026 is barely green now",
                           link: "https://www.coindesk.com/markets/2026/11/02/bitcoin-etfs-lost-usd643-million-in-outflows-friday-and-2026-is-barely-green-now",
                           at: Date.parse("Mon, 02 Nov 2026 06:46:41 +0000"), coins: [] });
  assert.equal(feed(raw("rssCointelegraph.xml"), "Cointelegraph")[0]!.link, "https://cointelegraph.com/news/btcpay-server-hot-wallet-thefts-older-versions");
  assert.equal(feed(raw("rssOdaily.xml"), "Odaily")[1]!.title, "1.49亿美元SOL存入多家交易所，某巨鲸10天内存入149万枚");
  const [atom] = feed(raw("atomBlockworks.xml"), "Blockworks");  // the alternate link, not the enclosure
  assert.deepEqual([atom!.link, atom!.at], ["https://blockworks.com/news/venezuelas-sanctions-stablecoins", Date.parse("2026-01-07T14:00:00.000Z")]);
  assert.deepEqual(feed("<rss><channel><item><title>No link</title></item></channel></rss>", "X"), []);
  assert.equal(feed("<rss><item><title>A &amp; B &#8217;s</title><link>https://x.test/a</link><pubDate>Mon, 02 Nov 2026 06:46:41 +0000</pubDate></item></rss>", "X")[0]!.title, "A & B ’s");
});

test("Binance Square: the posts naming a trading pair, seconds to milliseconds, the pairs' coins", () => {
  const [stocks, sol, ...rest] = square(fixture("binanceSquareNews.json"));
  assert.deepEqual(stocks!.coins, ["SPCXB", "METAB"]);
  assert.deepEqual(rest, []);  // Ryanair's costs name no pair
  assert.deepEqual({ link: sol!.link, at: sol!.at, coins: sol!.coins }, { link: "https://www.binance.com/en/square/post/383845750496711", at: 1793603541000, coins: ["SOL"] });
});

test("exchange announcements: Binance's link from its code, Bybit's publication time, OKX's", () => {
  const [listing] = binanceAnnouncements(fixture("binanceAnnouncements.json"));
  assert.deepEqual({ kind: listing!.kind, link: listing!.link, at: listing!.at },
                   { kind: "announcement", link: "https://www.binance.com/en/support/announcement/detail/a259777ee4104befa3daba5c1eadc7b5", at: 1793274532329 });
  assert.deepEqual(bybitAnnouncements(fixture("bybitAnnouncements.json")).map((a) => [a.title, a.at]),
                   [["Delisting of EPICUSDT Perpetual Contract", 1793178522000], ["Delisting of MITOUSDT Perpetual Contract", 1793178525000]]);
  assert.equal(okxAnnouncements(fixture("okxAnnouncements.json"))[1]!.at, 1793332810651);
});

test("Bithumb: only the notices naming a coin in brackets, their time in Korea", () => {
  const notices = bithumbNotices(fixture("bithumbNotices.json"));
  assert.deepEqual(notices.map((n) => n.coins), [["RECALL"], ["BLUR", "CORE"]]);  // the privacy notice names none
  assert.equal(notices[0]!.at, Date.parse("2026-10-30T22:30:00Z"));
});

test("a headline names the listed coins by code, by a large coin's name, or by BTC's and ETH's Chinese names", () => {
  const h = (title: string, coins: string[] = []): Headline => ({ source: "X", kind: "news", title, link: "https://x.test", at: 0, coins });
  const listed = new Set(["BTC", "ETH", "SOL", "EPIC", "PEPE", "AI", "LINK"]), names = new Map([["Bitcoin", "BTC"], ["Chainlink", "LINK"]]);
  assert.deepEqual(mentions(h("Whale Deposits 1.49 Million SOL"), listed, names), ["SOL"]);
  assert.deepEqual(mentions(h("Delisting of EPICUSDT Perpetual Contract"), listed, names), ["EPIC"]);
  assert.deepEqual(mentions(h("Bitcoin ETFs lost $643 million as Chainlink rallies"), listed, names), ["BTC", "LINK"]);
  assert.deepEqual(mentions(h("BTCPay Server warns of AI thefts"), listed, names), []);  // part of a word; a common acronym
  assert.deepEqual(mentions(h("bitcoin, said in passing"), listed, names), []);  // names only as written
  assert.deepEqual(mentions(h("比特币跌破7万美元，以太坊随之下跌"), listed, names), ["BTC", "ETH"]);
  assert.deepEqual(mentions(h("STOCKS | Tech", ["SPCXB", "SOL"]), listed, names), ["SOL"]);  // the source's, if listed
});

test("the record keeps each link once, for a week, the newest at most `limit`", () => {
  let now = Date.parse("2026-11-02T08:00:00Z");
  const record = new Headlines(() => now, 3);
  const h = (link: string, at: number, title = link): Headline => ({ source: "X", kind: "news", title, link, at, coins: [] });
  record.add([h("a", now - DAY), h("a", now, "again"), h("b", now - 8 * DAY), h("c", now - 2 * DAY)]);
  assert.deepEqual(record.list().map((x) => [x.link, x.title]), [["a", "a"], ["c", "c"]]);
  record.add([h("d", now), h("e", now - 3 * DAY)]);
  assert.deepEqual(record.list().map((x) => x.link), ["d", "a", "c"]);
  now += 6 * DAY + 1;  // "a" is now just over a week old
  record.add([]);
  assert.deepEqual(record.list().map((x) => x.link), ["d"]);
});
