/**
 * DexScreener public API client.
 * Docs: https://docs.dexscreener.com/api/reference
 * Rate limit: ~300 req/min, no auth.
 */

const BASE = "https://api.dexscreener.com";

export type DexPair = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: Record<string, { buys: number; sells: number }>;
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: { label?: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
};

export type EnrichedDexData = {
  pair: DexPair | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  change2h: number | null;
  change6h: number | null;
  change24h: number | null;
  imageUrl: string | null;
  socials: {
    twitter?: string;
    telegram?: string;
    website?: string;
    discord?: string;
  };
  pairCreatedAt: Date | null;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`DexScreener ${res.status}: ${url}`);
  }
  return (await res.json()) as T;
}

/**
 * Returns the highest-liquidity pair on Solana for a given mint.
 */
export async function fetchTopSolanaPair(mint: string): Promise<DexPair | null> {
  const data = await fetchJson<{ pairs: DexPair[] | null }>(
    `${BASE}/latest/dex/tokens/${mint}`,
  );
  const pairs = data?.pairs?.filter((p) => p.chainId === "solana") ?? [];
  if (!pairs.length) return null;
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return pairs[0];
}

function pickSocial(
  socials: DexPair["info"] extends infer I
    ? I extends { socials?: infer S }
      ? S
      : never
    : never,
  type: string,
): string | undefined {
  return socials?.find((s) => s.type.toLowerCase() === type)?.url;
}

export function enrich(pair: DexPair | null): EnrichedDexData {
  if (!pair) {
    return {
      pair: null,
      priceUsd: null,
      mcapUsd: null,
      fdvUsd: null,
      liquidityUsd: null,
      volume24h: null,
      change2h: null,
      change6h: null,
      change24h: null,
      imageUrl: null,
      socials: {},
      pairCreatedAt: null,
    };
  }
  const change6h = pair.priceChange?.h6 ?? null;
  const change24h = pair.priceChange?.h24 ?? null;
  // DexScreener doesn't expose 2h directly; approximate via h1 if missing.
  const change2h = pair.priceChange?.h1 ?? null;

  const websites = pair.info?.websites ?? [];
  const socials = pair.info?.socials ?? [];

  return {
    pair,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    mcapUsd: pair.marketCap ?? null,
    fdvUsd: pair.fdv ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    volume24h: pair.volume?.h24 ?? null,
    change2h,
    change6h,
    change24h,
    imageUrl: pair.info?.imageUrl ?? null,
    socials: {
      twitter: pickSocial(socials, "twitter"),
      telegram: pickSocial(socials, "telegram"),
      discord: pickSocial(socials, "discord"),
      website: websites[0]?.url,
    },
    pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null,
  };
}

export async function fetchEnriched(mint: string): Promise<EnrichedDexData> {
  const pair = await fetchTopSolanaPair(mint);
  return enrich(pair);
}
