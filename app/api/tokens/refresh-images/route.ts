import { NextRequest, NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import {
  fetchMetadataJson,
  getAssetBatch,
  isCanonicalImageUrl,
  normalizeImageUrl,
  pickMetadataUri,
} from "@/lib/sources/helius";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  mints: z.array(z.string().min(32).max(64)).min(1).max(100),
});

/**
 * Refresh logic, aligned with the "image_url has one canonical format" rule:
 *
 *   For every requested mint, look at what's currently in `image_url`.
 *     - If it matches the canonical format (i.e. is NOT the broken Helius-CDN
 *       wrapper), leave it alone.
 *     - Otherwise (null, or wrapped by the old code) re-resolve it: fetch the
 *       Metaplex metadata JSON via the saved `metadata_uri` (free), or via
 *       Helius DAS if the URI itself is missing (1 credit per ≤1000 mints
 *       across the whole batch), and overwrite `image_url` with the raw URL
 *       from `json.image`.
 *
 *   We never wrap the URL with any CDN — what we store is exactly what the
 *   metadata JSON advertises (with `ipfs://CID` rewritten to `https://ipfs.io`
 *   so browsers can load it).
 */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { mints } = parsed.data;

  const current = await db
    .select({
      mint: schema.tokens.mint,
      imageUrl: schema.tokens.imageUrl,
      metadataUri: schema.tokens.metadataUri,
    })
    .from(schema.tokens)
    .where(inArray(schema.tokens.mint, mints));

  const stale = current.filter((r) => !isCanonicalImageUrl(r.imageUrl));
  if (stale.length === 0) {
    return NextResponse.json({ updated: 0, skipped: mints.length, tokens: [] });
  }

  // Resolve any missing URIs in one DAS batch call (1 credit total).
  const needUri = stale.filter((r) => !r.metadataUri).map((r) => r.mint);
  const uriMap = new Map<string, string>();
  for (const r of stale) if (r.metadataUri) uriMap.set(r.mint, r.metadataUri);
  if (needUri.length > 0) {
    const assets = await getAssetBatch(needUri).catch(() => []);
    needUri.forEach((mint, i) => {
      const uri = pickMetadataUri(assets[i]);
      if (uri) uriMap.set(mint, uri);
    });
  }

  // Fetch each JSON in parallel and persist the raw `image` URL.
  const touched: string[] = [];
  await Promise.all(
    stale.map(async (r) => {
      const uri = uriMap.get(r.mint);
      if (!uri) return;
      const meta = await fetchMetadataJson(uri);
      const nextUrl = normalizeImageUrl(meta?.imageUrl ?? null);
      if (!nextUrl) return;
      touched.push(r.mint);
      await db
        .update(schema.tokens)
        .set({
          imageUrl: nextUrl,
          metadataUri: uri,
        })
        .where(sql`${schema.tokens.mint} = ${r.mint}`);
    }),
  );

  const rows =
    touched.length > 0
      ? await db
          .select()
          .from(schema.tokens)
          .where(inArray(schema.tokens.mint, touched))
      : [];

  return NextResponse.json({
    updated: rows.length,
    skipped: mints.length - stale.length,
    tokens: rows,
  });
}
