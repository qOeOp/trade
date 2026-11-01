import { useState } from "react";

// Binance's own coin logos, by base asset, from the static assets its site loads (no API; an asset
// listed only as futures may have none). Sent with no referrer: the host refuses another site's.
const logo = (base: string) => `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(base)}.png`;

/** A coin's logo (by base asset), 14px round, shown once its image loads; none when it fails, so offline
 *  there is none. */
export function CoinLogo({ coin }: { coin: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  if (state === "failed") return null;
  return <img src={logo(coin)} alt="" width={14} height={14} referrerPolicy="no-referrer" onLoad={() => setState("loaded")}
              onError={() => setState("failed")} className={`size-3.5 shrink-0 rounded-full ${state === "loaded" ? "" : "invisible"}`} />;
}
