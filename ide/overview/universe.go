package main

// The coins the Market page draws: Binance USDT-margined perpetuals in trading with a coin underlying,
// stablecoins left out by the market's own rule (market/universe.py), each in one sector merged
// from the contract's Binance tag (`underlyingSubType`). A contract with no tag is in Other.

// Contract is one drawn perpetual.
type Contract struct{ Symbol, Base, Sector string }

// sectors are the sectors in the page's order; Other is always last.
var sectors = []string{"Layer 1", "PoW", "DeFi", "Meme", "AI", "Infrastructure", "Layer 2", "Gaming & NFT", "Payments", "RWA", "Other"}

var sectorGroup = map[string]string{
	"Layer-1": "Layer 1", "Layer-2": "Layer 2", "DeFi": "DeFi", "AI": "AI", "Meme": "Meme", "Chinese": "Meme",
	"Infrastructure": "Infrastructure", "Storage": "Infrastructure", "Gaming": "Gaming & NFT", "Metaverse": "Gaming & NFT",
	"NFT": "Gaming & NFT", "PoW": "PoW", "Payment": "Payments", "RWA": "RWA",
}
var genericTags = map[string]bool{"Crypto": true, "Alpha": true}
var stablecoinBases = map[string]bool{"USDC": true, "FDUSD": true, "TUSD": true, "USDP": true, "DAI": true, "BUSD": true}

func sectorOf(tags []any) string {
	for _, t := range tags {
		tag, _ := t.(string)
		if genericTags[tag] {
			continue
		}
		if group, ok := sectorGroup[tag]; ok {
			return group
		}
		break
	}
	return "Other"
}

// contracts reads the contracts of `GET /fapi/v1/exchangeInfo`, in its order.
func contracts(info any) ([]Contract, error) {
	list, err := rows(field(info, "symbols"))
	if err != nil {
		return nil, err
	}
	out := []Contract{}
	each(list, func(s obj) {
		base, _ := str(s, "baseAsset")
		symbol, _ := str(s, "symbol")
		if s["contractType"] == "PERPETUAL" && s["status"] == "TRADING" && s["quoteAsset"] == "USDT" && s["underlyingType"] == "COIN" && !stablecoinBases[base] {
			tags, _ := s["underlyingSubType"].([]any)
			out = append(out, Contract{symbol, base, sectorOf(tags)})
		}
	})
	return out, nil
}
