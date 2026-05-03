import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import {
  fetchTokenMetadata,
  getHoldersCount,
  getMintCreationTime,
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
  const [dex, meta] = await Promise.all([
    fetchEnriched(m.mint).catch(() => null),
    fetchTokenMetadata(m.mint).catch(() => null),
  ]);

  const ticker = meta?.symbol ?? dex?.pair?.baseToken.symbol ?? null;
  const name = meta?.name ?? dex?.pair?.baseToken.name ?? null;
  const description = meta?.description ?? null;
  const imageUrl = meta?.imageUrl ?? dex?.imageUrl ?? null;
  const mergedSocials = {
    ...(dex?.socials ?? {}),
    ...(meta?.socials ?? {}),
  };

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
    metadataUri: meta?.metadataUri ?? null,
    socials: mergedSocials,
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

/**
 * Fire-and-forget retry loop for the metadata image. Helius DAS can lag the
 * actual on-chain Metaplex metadata by a few seconds for fresh migrations,
 * so we re-poll a few times before giving up.
 */
export async function retryImageInBackground(mint: string) {
  const delays = [3_000, 8_000, 15_000];
  for (const wait of delays) {
    await new Promise((r) => setTimeout(r, wait));
    try {
      const [row] = await db
        .select({ imageUrl: schema.tokens.imageUrl })
        .from(schema.tokens)
        .where(sql`${schema.tokens.mint} = ${mint}`)
        .limit(1);
      if (row?.imageUrl) return; // somebody else (refresh) already filled it

      const meta = await fetchTokenMetadata(mint);
      if (meta.imageUrl) {
        await db
          .update(schema.tokens)
          .set({
            imageUrl: meta.imageUrl,
            ticker: sql`coalesce(${schema.tokens.ticker}, ${meta.symbol ?? null})`,
            name: sql`coalesce(${schema.tokens.name}, ${meta.name ?? null})`,
            description: sql`coalesce(${schema.tokens.description}, ${meta.description ?? null})`,
          })
          .where(sql`${schema.tokens.mint} = ${mint}`);
        return;
      }
    } catch {
      // ignore, try next backoff
    }
  }
}
