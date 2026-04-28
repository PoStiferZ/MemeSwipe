import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import {
  getAsset,
  getHoldersCount,
  getMintCreationTime,
  pickAssetImage,
} from "@/lib/sources/helius";
import type { DetectedMigration } from "@/lib/sources/pumpswap";
import { sql } from "drizzle-orm";

export type EnrichedTokenRow = typeof schema.tokens.$inferInsert;

/**
 * Combine on-chain (Helius) and market (DexScreener) data into a single row
 * ready to upsert into the `tokens` table.
 */
export async function buildTokenRow(
  m: DetectedMigration,
): Promise<EnrichedTokenRow> {
  const [dex, asset] = await Promise.all([
    fetchEnriched(m.mint).catch(() => null),
    getAsset(m.mint).catch(() => null),
  ]);

  const meta = asset?.content?.metadata;
  const ticker =
    meta?.symbol ??
    asset?.token_info?.symbol ??
    dex?.pair?.baseToken.symbol ??
    null;
  const name = meta?.name ?? dex?.pair?.baseToken.name ?? null;
  const description = meta?.description ?? null;
  const imageUrl =
    pickAssetImage(asset ?? null) ?? // prefers Helius CDN
    dex?.imageUrl ??
    null;

  return {
    mint: m.mint,
    ticker,
    name,
    description,
    imageUrl,
    createdAt: null, // filled lazily
    migratedAt: m.blockTime,
    migrationSignature: m.signature,
    poolAddress: m.poolAddress,
    socials: dex?.socials ?? {},
    priceUsd: dex?.priceUsd != null ? String(dex.priceUsd) : null,
    mcapUsd: dex?.mcapUsd != null ? String(dex.mcapUsd) : null,
    fdvUsd: dex?.fdvUsd != null ? String(dex.fdvUsd) : null,
    liquidityUsd: dex?.liquidityUsd != null ? String(dex.liquidityUsd) : null,
    volume24h: dex?.volume24h != null ? String(dex.volume24h) : null,
    change2h: dex?.change2h != null ? String(dex.change2h) : null,
    change6h: dex?.change6h != null ? String(dex.change6h) : null,
    change24h: dex?.change24h != null ? String(dex.change24h) : null,
    athUsd: dex?.priceUsd != null ? String(dex.priceUsd) : null,
    athMcapUsd: dex?.mcapUsd != null ? String(dex.mcapUsd) : null,
    athAt: dex?.priceUsd != null ? new Date() : null,
    lastIndexedAt: new Date(),
    lastSnapshotAt: dex?.priceUsd != null ? new Date() : null,
  };
}

export async function upsertToken(row: EnrichedTokenRow) {
  await db
    .insert(schema.tokens)
    .values(row)
    .onConflictDoUpdate({
      target: schema.tokens.mint,
      set: {
        ticker: sql`coalesce(excluded.ticker, ${schema.tokens.ticker})`,
        name: sql`coalesce(excluded.name, ${schema.tokens.name})`,
        description: sql`coalesce(excluded.description, ${schema.tokens.description})`,
        imageUrl: sql`coalesce(excluded.image_url, ${schema.tokens.imageUrl})`,
        socials: sql`coalesce(excluded.socials, ${schema.tokens.socials})`,
        priceUsd: sql`excluded.price_usd`,
        mcapUsd: sql`excluded.mcap_usd`,
        fdvUsd: sql`excluded.fdv_usd`,
        liquidityUsd: sql`excluded.liquidity_usd`,
        volume24h: sql`excluded.volume_24h`,
        change2h: sql`excluded.change_2h`,
        change6h: sql`excluded.change_6h`,
        change24h: sql`excluded.change_24h`,
        athUsd: sql`greatest(coalesce(${schema.tokens.athUsd}, 0), coalesce(excluded.price_usd, 0))`,
        athMcapUsd: sql`greatest(coalesce(${schema.tokens.athMcapUsd}, 0), coalesce(excluded.mcap_usd, 0))`,
        athAt: sql`case when coalesce(excluded.price_usd, 0) > coalesce(${schema.tokens.athUsd}, 0) or coalesce(excluded.mcap_usd, 0) > coalesce(${schema.tokens.athMcapUsd}, 0) then excluded.last_snapshot_at else ${schema.tokens.athAt} end`,
        lastIndexedAt: sql`now()`,
        lastSnapshotAt: sql`excluded.last_snapshot_at`,
      },
    });

  await db.insert(schema.priceSnapshots).values({
    mint: row.mint,
    priceUsd: row.priceUsd ?? null,
    mcapUsd: row.mcapUsd ?? null,
    liquidityUsd: row.liquidityUsd ?? null,
    volume24h: row.volume24h ?? null,
  });
}

/**
 * Fill `createdAt` and `holdersCount` for a token. Slow (multi-RPC) — call in
 * a background pass, not during the burst migration write.
 */
export async function backfillSlowFields(mint: string) {
  const [createdAt, holders] = await Promise.all([
    getMintCreationTime(mint).catch(() => null),
    getHoldersCount(mint).catch(() => null),
  ]);
  await db
    .update(schema.tokens)
    .set({
      createdAt: createdAt ?? undefined,
      holdersCount: holders ?? undefined,
      holdersUpdatedAt: holders != null ? new Date() : undefined,
    })
    .where(sql`${schema.tokens.mint} = ${mint}`);
}
