import { useState, type ReactNode } from "react";
import { baseAsset } from "../lib/paperApi";

// Binance's own coin logos, by base asset, from the static assets its site loads (no API; an asset
// listed only as futures may have none). Sent with no referrer: the host refuses another site's.
const coinLogoUrl = (coin: string) => `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(baseAsset(coin))}.png`;

/** A coin's or contract's logo (normalized to its base asset: 1000PEPEUSDT → PEPE), 14px round, shown
 *  once its image loads; none when it fails, so offline there is none. */
export function CoinLogo({ coin }: { coin: string }) {
  const src = coinLogoUrl(coin);
  // the logo this state speaks for and whether it loaded or failed; another coin's logo starts unseen
  const [seen, setSeen] = useState<{ src: string; ok: boolean } | null>(null);
  const state = seen?.src === src ? seen.ok : null;
  if (state === false) return null;
  return <img key={src} src={src} alt="" width={14} height={14} referrerPolicy="no-referrer" onLoad={() => setSeen({ src, ok: true })}
              onError={() => setSeen({ src, ok: false })} className={`size-3.5 shrink-0 rounded-full ${state ? "" : "invisible"}`} />;
}

/** A coin or contract paired with its logo (`children` defaults to `coin`). */
export const CoinName = ({ coin, className, children }: { coin: string; className?: string; children?: ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`.trim()}><CoinLogo coin={coin} /><span className="truncate">{children ?? coin}</span></span>
);
