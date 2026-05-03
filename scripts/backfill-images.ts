/**
 * Re-fetch images for tokens with NULL image_url, using Helius DAS (which
 * returns the CDN-cached image URL — fast and reliable, no IPFS issues).
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/backfill-images.ts
 */
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchTokenMetadataBatch } from "@/lib/sources/helius";

const BATCH = 100; // getAssetBatch supports up to 1000, 100 keeps memory sane

async function main() {
  const rows = await db
    .select({
      mint: schema.tokens.mint,
      ticker: schema.tokens.ticker,
      imageUrl: schema.tokens.imageUrl,
      metadataUri: schema.tokens.metadataUri,
    })
    .from(schema.tokens)
    .where(sql`${schema.tokens.imageUrl} IS NULL OR ${schema.tokens.metadataUri} IS NULL`);

  console.log(`[backfill-images] ${rows.length} tokens to enrich`);

  let fixed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    console.log(`  batch ${i + 1}-${i + slice.length}…`);
    const result = await fetchTokenMetadataBatch(slice.map((r) => r.mint));
    await Promise.all(
      slice.map(async (r) => {
        const meta = result.get(r.mint);
        if (!meta) return;
        const patch: Record<string, unknown> = {};
        if (meta.imageUrl && !r.imageUrl) patch.imageUrl = meta.imageUrl;
        if (meta.metadataUri && !r.metadataUri)
          patch.metadataUri = meta.metadataUri;
        if (meta.symbol) patch.ticker = sql`coalesce(${schema.tokens.ticker}, ${meta.symbol})`;
        if (meta.name) patch.name = sql`coalesce(${schema.tokens.name}, ${meta.name})`;
        if (meta.description)
          patch.description = sql`coalesce(${schema.tokens.description}, ${meta.description})`;
        if (Object.keys(patch).length === 0) return;
        await db
          .update(schema.tokens)
          .set(patch)
          .where(sql`${schema.tokens.mint} = ${r.mint}`);
        if (meta.imageUrl) fixed++;
      }),
    );
  }
  console.log(`[backfill-images] done — ${fixed}/${rows.length} got an image`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
