import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import { getAsset, pickAssetImage } from "@/lib/sources/helius";
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

  if (!refreshed.imageUrl) {
    try {
      const asset = await getAsset(mint);
      const image = pickAssetImage(asset);
      if (image) {
        await db
          .update(schema.tokens)
          .set({ imageUrl: image })
          .where(sql`${schema.tokens.mint} = ${mint}`);
        refreshed = { ...refreshed, imageUrl: image };
      }
    } catch {
      // silent
    }
  }

  return NextResponse.json({ token: refreshed });
}
