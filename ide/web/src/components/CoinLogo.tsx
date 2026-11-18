import { useState, type ReactNode } from "react";
import { baseAsset } from "../lib/paperApi";

// Binance's own coin logos, by base asset, from the static assets its site loads (no API; an asset
// listed only as futures may have none). Sent with no referrer: the host refuses another site's.
export const coinLogoUrl = (coin: string) => `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(baseAsset(coin))}.png`;

/** A coin's or contract's logo (normalized to its base asset: 1000PEPEUSDT → PEPE), 14px round, shown
 *  once its image loads; none when it fails, so offline there is none. */
export function CoinLogo({ coin }: { coin: string }) {
  const src = coinLogoUrl(coin);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return <img key={src} src={src} alt="" width={14} height={14} referrerPolicy="no-referrer" onLoad={() => setLoaded(src)}
              onError={() => setFailed(src)} className={`size-3.5 shrink-0 rounded-full ${loaded === src ? "" : "invisible"}`} />;
}

/** A coin or contract paired with its logo (`children` defaults to `coin`). */
export const CoinName = ({ coin, className, children }: { coin: string; className?: string; children?: ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`.trim()}><CoinLogo coin={coin} /><span className="truncate">{children ?? coin}</span></span>
);
