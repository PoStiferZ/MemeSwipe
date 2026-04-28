/**
 * Re-fetch images for tokens with NULL image_url, using Helius DAS (which
 * returns the CDN-cached image URL — fast and reliable, no IPFS issues).
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/backfill-images.ts
 */
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getAsset, pickAssetImage } from "@/lib/sources/helius";

const THROTTLE_MS = Number(process.env.HELIUS_THROTTLE_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = await db
    .select({ mint: schema.tokens.mint, ticker: schema.tokens.ticker })
    .from(schema.tokens)
    .where(sql`${schema.tokens.imageUrl} IS NULL`);

  console.log(`[backfill-images] ${rows.length} tokens missing an image`);

  let fixed = 0;
  for (let i = 0; i < rows.length; i++) {
    const { mint, ticker } = rows[i];
    try {
      const asset = await getAsset(mint);
      const image = pickAssetImage(asset);
      if (image) {
        await db
          .update(schema.tokens)
          .set({ imageUrl: image })
          .where(sql`${schema.tokens.mint} = ${mint}`);
        fixed++;
        console.log(`  ✓ ${ticker ?? mint.slice(0, 6)} → ${image.slice(0, 80)}`);
      } else {
        console.log(`  · ${ticker ?? mint.slice(0, 6)} no image in DAS`);
      }
    } catch (err) {
      console.error(
        `  ✗ ${ticker ?? mint.slice(0, 6)} ${(err as Error).message}`,
      );
    }
    if (i < rows.length - 1) await sleep(THROTTLE_MS);
  }
  console.log(`[backfill-images] done — ${fixed}/${rows.length} fixed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
