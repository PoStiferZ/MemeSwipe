import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import {
  fetchTokenMetadata,
  getMintCreationTime,
  normalizeImageUrl,
} from "@/lib/sources/helius";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  wallet: z.string().min(32).max(44),
  // base58 Solana address — accept anything between 32 and 44 chars.
  mint: z.string().min(32).max(44),
});

/**
 * Manual "Add to liked" — the user pasted a CA that isn't in our table
 * (didn't migrate through Pump.fun, or we missed the webhook).
 *
 * Pipeline:
 *   1. If the token row doesn't exist, fetch market data from DexScreener
 *      and metadata from Helius DAS, then upsert it. We use the on-chain
 *      first-tx time as `migrated_at` when available so the watchlist row
 *      sorts naturally; otherwise fall back to "now".
 *   2. Insert (or upgrade) the swipe row as a "like".
 *   3. Return the freshly-loaded token so the client can prepend it.
 */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { wallet, mint } = parsed.data;

  await db
    .insert(schema.users)
    .values({ wallet })
    .onConflictDoNothing({ target: schema.users.wallet });

  let [row] = await db
    .select()
    .from(schema.tokens)
    .where(eq(schema.tokens.mint, mint))
    .limit(1);

  if (!row) {
    const [dex, meta, createdAt] = await Promise.all([
      fetchEnriched(mint).catch(() => null),
      fetchTokenMetadata(mint).catch(() => null),
      getMintCreationTime(mint).catch(() => null),
    ]);

    if (!dex && !meta) {
      return NextResponse.json(
        { error: "Token not found on DexScreener or on-chain metadata" },
        { status: 404 },
      );
    }

    const ticker = meta?.symbol ?? dex?.pair?.baseToken.symbol ?? null;
    const name = meta?.name ?? dex?.pair?.baseToken.name ?? null;
    const imageUrl = normalizeImageUrl(meta?.imageUrl ?? dex?.imageUrl ?? null);
    const now = new Date();

    await db
      .insert(schema.tokens)
      .values({
        mint,
        ticker,
        name,
        description: meta?.description ?? null,
        imageUrl,
        metadataUri: meta?.metadataUri ?? null,
        socials: { ...(dex?.socials ?? {}), ...(meta?.socials ?? {}) },
        createdAt,
        // Use on-chain creation time as a stand-in for migration time,
        // otherwise "now" — the value is mostly used for list ordering.
        migratedAt: createdAt ?? now,
        migrationSignature: null,
        poolAddress: dex?.pair?.pairAddress ?? null,
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
        athAt: dex?.priceUsd != null ? now : null,
        lastIndexedAt: now,
        lastSnapshotAt: dex?.priceUsd != null ? now : null,
      })
      .onConflictDoNothing({ target: schema.tokens.mint });

    [row] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.mint, mint))
      .limit(1);
  }

  if (!row) {
    return NextResponse.json(
      { error: "Failed to load token after insert" },
      { status: 500 },
    );
  }

  await db
    .insert(schema.swipes)
    .values({ wallet, mint, action: "like" })
    .onConflictDoUpdate({
      target: [schema.swipes.wallet, schema.swipes.mint],
      set: { action: "like", createdAt: new Date() },
    });

  return NextResponse.json({ ok: true, token: row });
}
