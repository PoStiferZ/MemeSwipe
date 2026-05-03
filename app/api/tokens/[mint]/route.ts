import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchEnriched } from "@/lib/sources/dexscreener";
import {
  fetchMetadataJson,
  getAsset,
  isCanonicalImageUrl,
  normalizeImageUrl,
  pickMetadataUri,
} from "@/lib/sources/helius";
import { applyDexPatch } from "@/lib/indexer/applyDexPatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-token refresh:
 *  - DexScreener for price/mcap/volume (always).
 *  - If `image_url` isn't in canonical format (i.e. it's null or wrapped by
 *    the old Helius CDN code), re-resolve from the metadata JSON and save.
 *    The URI itself is fetched from Helius DAS only when missing.
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

  if (!isCanonicalImageUrl(refreshed.imageUrl)) {
    try {
      let uri = refreshed.metadataUri;
      if (!uri) {
        const asset = await getAsset(mint);
        uri = pickMetadataUri(asset);
      }
      if (uri) {
        const meta = await fetchMetadataJson(uri);
        const nextUrl = normalizeImageUrl(meta?.imageUrl ?? null);
        if (nextUrl || uri !== refreshed.metadataUri) {
          const patch: Partial<typeof refreshed> = { metadataUri: uri };
          if (nextUrl) patch.imageUrl = nextUrl;
          await db
            .update(schema.tokens)
            .set(patch)
            .where(sql`${schema.tokens.mint} = ${mint}`);
          refreshed = { ...refreshed, ...patch };
        }
      }
    } catch {
      // silent
    }
  }

  return NextResponse.json({ token: refreshed });
}
