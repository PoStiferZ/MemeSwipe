/**
 * Build the Axiom chart URL for a token. Axiom routes by PumpSwap pool
 * address (`/meme/<pool>?chain=sol`). When we don't have a pool address
 * stored — older rows or manually-added tokens whose DexScreener pair
 * wasn't found — we fall back to the mint, which still resolves on
 * Axiom for most Pump.fun tokens.
 */
export function axiomUrl(token: { mint: string; poolAddress?: string | null }): string {
  const id = token.poolAddress ?? token.mint;
  return `https://axiom.trade/meme/${id}?chain=sol`;
}

export function dexscreenerUrl(mint: string): string {
  return `https://dexscreener.com/solana/${mint}`;
}

/**
 * Pick where a card click should land. Touch devices get DexScreener
 * (its mobile site is leagues better than Axiom's), desktops get Axiom
 * (richer trading UI, faster). Detection uses the `pointer: coarse`
 * media query — true on phones/tablets, false on mouse-driven desktops.
 */
export function tokenChartUrl(token: { mint: string; poolAddress?: string | null }): string {
  if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
    return dexscreenerUrl(token.mint);
  }
  return axiomUrl(token);
}

export function formatUsd(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(3)}`;
}

export function formatPercent(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export function formatInt(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(v));
}

export function formatDuration(fromMs: number | null, toMs: number | null): string {
  if (fromMs == null || toMs == null) return "—";
  const ms = Math.max(0, toMs - fromMs);
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (h < 24) return remMin ? `${h}h ${remMin}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
