package main

// The page's second level: sub-sectors of the larger sectors, each a list of CoinGecko categories (no free
// source has a category tree, so this table is ours). A coin goes to the first sub-sector of its sector
// whose categories hold it; one in none goes to the sector's rest. A coin Binance gives no tag (Other)
// first takes the first sector here whose categories hold it.

type subsector struct {
	name       string
	categories []string
}

var subsectorSectors = []string{"DeFi", "Meme", "AI", "Infrastructure", "Gaming & NFT", "Other"}

var subsectors = map[string][]subsector{
	"DeFi": {{"Perpetuals", []string{"decentralized-perpetuals"}}, {"Derivatives", []string{"decentralized-derivatives", "synthetic"}},
		{"DEX", []string{"decentralized-exchange"}}, {"Lending", []string{"lending-borrowing"}},
		{"Liquid staking", []string{"liquid-staking", "liquid-staking-governance-tokens", "liquid-restaking-governance-token", "restaking"}},
		{"Yield", []string{"yield-farming", "yield-aggregator", "yield-optimizer", "yield-tokenization"}}},
	"Meme": {{"Dog", []string{"dog-themed-coins"}}, {"Frog", []string{"frog-themed-coins"}}, {"Cat", []string{"cat-themed-coins"}}, {"AI Meme", []string{"ai-meme-coins"}},
		{"Celebrity", []string{"celebrity-themed-coins"}}, {"Solana Meme", []string{"solana-meme-coins"}}},
	"AI": {{"AI Agents", []string{"ai-agents", "ai-agent-launchpad", "ai-framework"}}, {"AI Applications", []string{"ai-applications"}}, {"DePIN", []string{"depin"}}},
	"Infrastructure": {{"Oracle", []string{"oracle"}}, {"Storage", []string{"data-storage"}}, {"Interoperability", []string{"interoperability", "cross-chain-communication"}},
		{"Zero knowledge", []string{"zero-knowledge-zk"}}, {"DePIN", []string{"depin"}}, {"Modular", []string{"data-availability", "modular-blockchain"}}},
	"Gaming & NFT": {{"Gaming", []string{"gaming", "gaming-platform", "gaming-blockchains", "on-chain-gaming"}}, {"Metaverse", []string{"metaverse"}},
		{"NFT", []string{"non-fungible-tokens-nft"}}},
	"Other": {{"Exchange tokens", []string{"centralized-exchange-token-cex", "exchange-based-tokens"}}, {"Prediction markets", []string{"prediction-markets"}},
		{"SocialFi", []string{"socialfi", "decentralized-social-media-desoc"}}, {"Launchpads", []string{"launchpad"}}, {"Sports", []string{"sports", "sports-games"}},
		{"DeSci", []string{"decentralized-science-desci"}}},
}

// categories is every category the table names, each once: what the daily membership pass asks CoinGecko
// for.
var categories = func() []string {
	seen := map[string]bool{}
	var out []string
	for _, sector := range subsectorSectors {
		for _, sub := range subsectors[sector] {
			for _, c := range sub.categories {
				if !seen[c] {
					seen[c] = true
					out = append(out, c)
				}
			}
		}
	}
	return out
}()

// A sector splits once it holds minSector coins; a smaller sub-sector folds into the rest.
const minSector, minSubsector = 25, 2

func rest(sector string) string {
	if sector == "Other" {
		return "Unsorted"
	}
	return "Other " + sector
}

// Place is a coin's sector and sub-sector.
type Place struct {
	Sector    string
	Subsector *string
}

// placing is what place needs of a coin; id is "" without a CoinGecko id.
type placing struct{ Symbol, Sector, ID string }

// place is each coin's sector and sub-sector, `held` holding each CoinGecko id's categories. A sector that
// is too small, has no table or would come out as a single sub-sector has none.
func place(coins []placing, held map[string]map[string]bool) map[string]*Place {
	out := make(map[string]*Place, len(coins))
	for _, c := range coins {
		in := held[c.ID]
		hit := func(sector string) *string {
			for _, sub := range subsectors[sector] {
				for _, category := range sub.categories {
					if in[category] {
						return &sub.name
					}
				}
			}
			return nil
		}
		found := &Place{c.Sector, hit(c.Sector)}
		if c.Sector == "Other" {
			for _, s := range sectors {
				if name := hit(s); s != "Other" && name != nil {
					found = &Place{s, name}
					break
				}
			}
		}
		out[c.Symbol] = found
	}
	bySector := map[string][]*Place{}
	for _, p := range out {
		bySector[p.Sector] = append(bySector[p.Sector], p)
	}
	for _, sector := range sectors {
		placed := bySector[sector]
		if subsectors[sector] == nil || len(placed) < minSector {
			for _, p := range placed {
				p.Subsector = nil
			}
			continue
		}
		count := map[string]int{}
		for _, p := range placed {
			if p.Subsector != nil {
				count[*p.Subsector]++
			}
		}
		leftover := rest(sector)
		kinds := map[string]bool{}
		for _, p := range placed {
			if p.Subsector == nil || count[*p.Subsector] < minSubsector {
				p.Subsector = &leftover
			}
			kinds[*p.Subsector] = true
		}
		if len(kinds) < 2 {
			for _, p := range placed {
				p.Subsector = nil
			}
		}
	}
	return out
}
