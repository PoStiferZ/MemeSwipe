import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import { getHoldersCount } from "@/lib/sources/helius";

/**
 * Refresh price + mcap + holders for the N most-recently-migrated tokens.
 * Called by Vercel Cron every 5 min.
 */
export async function refreshRecentTokens(limit = 200) {
  const rows = await db
    .select({ mint: schema.tokens.mint, ath: schema.tokens.athUsd })
    .from(schema.tokens)
    .orderBy(sql`${schema.tokens.migratedAt} desc`)
    .limit(limit);

  let priceUpdated = 0;
  let holdersUpdated = 0;
  const now = new Date();

  for (const row of rows) {
    try {
      const dex = await fetchEnriched(row.mint);
      if (dex.priceUsd != null) {
        priceUpdated++;
        const newAth = Math.max(Number(row.ath ?? 0), dex.priceUsd);
        await db
          .update(schema.tokens)
          .set({
            priceUsd: String(dex.priceUsd),
            mcapUsd: dex.mcapUsd != null ? String(dex.mcapUsd) : null,
            fdvUsd: dex.fdvUsd != null ? String(dex.fdvUsd) : null,
            liquidityUsd: dex.liquidityUsd != null ? String(dex.liquidityUsd) : null,
            volume24h: dex.volume24h != null ? String(dex.volume24h) : null,
            change2h: dex.change2h != null ? String(dex.change2h) : null,
            change6h: dex.change6h != null ? String(dex.change6h) : null,
            change24h: dex.change24h != null ? String(dex.change24h) : null,
            athUsd: String(newAth),
            athAt: newAth > Number(row.ath ?? 0) ? now : undefined,
            lastSnapshotAt: now,
          })
          .where(sql`${schema.tokens.mint} = ${row.mint}`);

        await db.insert(schema.priceSnapshots).values({
          mint: row.mint,
          priceUsd: String(dex.priceUsd),
          mcapUsd: dex.mcapUsd != null ? String(dex.mcapUsd) : null,
          liquidityUsd: dex.liquidityUsd != null ? String(dex.liquidityUsd) : null,
          volume24h: dex.volume24h != null ? String(dex.volume24h) : null,
        });
      }
    } catch {
      // soft-fail, will retry next cron tick
    }
  }

  // Holders are RPC-heavy: refresh the ones with the stalest count among the top.
  const stale = await db
    .select({ mint: schema.tokens.mint })
    .from(schema.tokens)
    .orderBy(
      sql`${schema.tokens.holdersUpdatedAt} asc nulls first`,
    )
    .limit(20);

  for (const { mint } of stale) {
    try {
      const count = await getHoldersCount(mint);
      await db
        .update(schema.tokens)
        .set({ holdersCount: count, holdersUpdatedAt: new Date() })
        .where(sql`${schema.tokens.mint} = ${mint}`);
      holdersUpdated++;
    } catch {
      // ignore
    }
  }

  return { priceUpdated, holdersUpdated };
}
