import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { EnrichedDexData } from "@/lib/sources/dexscreener";

type TokenRow = typeof schema.tokens.$inferSelect;

export async function applyDexPatch(
  row: TokenRow,
  dex: EnrichedDexData,
  now: Date,
): Promise<TokenRow> {
  // Backfill missing metadata from DexScreener even if no price yet —
  // a freshly-migrated token can hit our DB before DexScreener indexes it,
  // leaving ticker/name/image null forever otherwise.
  const dexTicker = dex.pair?.baseToken.symbol ?? null;
  const dexName = dex.pair?.baseToken.name ?? null;
  const ticker = row.ticker ?? dexTicker;
  const name = row.name ?? dexName;
  const imageUrl = row.imageUrl ?? dex.imageUrl ?? null;
  const socials =
    row.socials && Object.keys(row.socials as object).length > 0
      ? row.socials
      : dex.socials ?? row.socials;

  if (dex.priceUsd == null) {
    // No price yet, but maybe metadata changed — only persist if it changed.
    if (ticker === row.ticker && name === row.name && imageUrl === row.imageUrl) {
      return row;
    }
    const metaPatch = { ticker, name, imageUrl, socials };
    await db
      .update(schema.tokens)
      .set(metaPatch)
      .where(sql`${schema.tokens.mint} = ${row.mint}`);
    return { ...row, ...metaPatch };
  }

  const oldAth = Number(row.athUsd ?? 0);
  const newAth = Math.max(oldAth, dex.priceUsd);
  const athAt = newAth > oldAth ? now : row.athAt;

  const patch = {
    ticker,
    name,
    imageUrl,
    socials,
    priceUsd: String(dex.priceUsd),
    mcapUsd: dex.mcapUsd != null ? String(dex.mcapUsd) : null,
    fdvUsd: dex.fdvUsd != null ? String(dex.fdvUsd) : null,
    liquidityUsd: dex.liquidityUsd != null ? String(dex.liquidityUsd) : null,
    volume24h: dex.volume24h != null ? String(dex.volume24h) : null,
    change2h: dex.change2h != null ? String(dex.change2h) : null,
    change6h: dex.change6h != null ? String(dex.change6h) : null,
    change24h: dex.change24h != null ? String(dex.change24h) : null,
    athUsd: String(newAth),
    athAt,
    lastSnapshotAt: now,
  };

  await db
    .update(schema.tokens)
    .set(patch)
    .where(sql`${schema.tokens.mint} = ${row.mint}`);

  await db.insert(schema.priceSnapshots).values({
    mint: row.mint,
    priceUsd: patch.priceUsd,
    mcapUsd: patch.mcapUsd,
    liquidityUsd: patch.liquidityUsd,
    volume24h: patch.volume24h,
  });

  return { ...row, ...patch };
}
