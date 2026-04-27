export type ApiToken = {
  mint: string;
  ticker: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  createdAt: string | null;
  migratedAt: string;
  migrationSignature: string | null;
  poolAddress: string | null;
  socials: {
    twitter?: string;
    telegram?: string;
    website?: string;
    discord?: string;
  } | null;
  holdersCount: number | null;
  holdersUpdatedAt: string | null;
  priceUsd: string | null;
  mcapUsd: string | null;
  fdvUsd: string | null;
  liquidityUsd: string | null;
  volume24h: string | null;
  change2h: string | null;
  change6h: string | null;
  change24h: string | null;
  athUsd: string | null;
  athMcapUsd: string | null;
  athAt: string | null;
  lastIndexedAt: string;
  lastSnapshotAt: string | null;
};

export type Filters = {
  minMcap: number;
  minHolders: number;
  sinceDays: number;
};

export const DEFAULT_FILTERS: Filters = {
  minMcap: 0,
  minHolders: 0,
  sinceDays: 1,
};
