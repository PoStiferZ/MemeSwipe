import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import { fetchMetadataJson, fetchTokenMetadata } from "@/lib/sources/helius";
import { applyDexPatch } from "@/lib/indexer/applyDexPatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-token refresh — called by the swipe deck when a card becomes active
 * so the user always sees current price/mcap/volume right before deciding.
 *
 * If the image is still missing after DexScreener, fall back to Helius DAS
 * (which gives us the CDN-cached URL — much more reliable than IPFS).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const [row] = await db
    .select()
    .from(schema.tokens)
    .where(eq(schema.tokens.mint, mint))
    .limit(1);

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let refreshed = row;
  try {
    const dex = await fetchEnriched(mint);
    refreshed = await applyDexPatch(row, dex, new Date());
  } catch {
    // keep row as-is
  }

  // Image refresh: prefer the saved metadata_uri (just refetch JSON, free,
  // no Helius credit) and fall back to DAS only when we don't have it yet.
  try {
    let meta = null;
    if (refreshed.metadataUri) {
      meta = await fetchMetadataJson(refreshed.metadataUri);
    }
    if (!meta || (!meta.imageUrl && !refreshed.imageUrl)) {
      const full = await fetchTokenMetadata(mint);
      meta = full;
      if (full.metadataUri && full.metadataUri !== refreshed.metadataUri) {
        await db
          .update(schema.tokens)
          .set({ metadataUri: full.metadataUri })
          .where(sql`${schema.tokens.mint} = ${mint}`);
        refreshed = { ...refreshed, metadataUri: full.metadataUri };
      }
    }
    const patch: Partial<typeof refreshed> = {};
    if (meta?.imageUrl) patch.imageUrl = meta.imageUrl;
    if (!refreshed.ticker && meta?.symbol) patch.ticker = meta.symbol;
    if (!refreshed.name && meta?.name) patch.name = meta.name;
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.tokens)
        .set(patch)
        .where(sql`${schema.tokens.mint} = ${mint}`);
      refreshed = { ...refreshed, ...patch };
    }
  } catch {
    // silent
  }

  return NextResponse.json({ token: refreshed });
}
