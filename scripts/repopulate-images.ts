/**
 * 1. NULLs every `image_url` in the table.
 * 2. Walks all rows in batches of 100 and re-resolves them through the
 *    canonical pipeline:
 *      DAS getAssetBatch → metadata_uri → fetch JSON → raw `image` URL
 *    Persists `image_url` (raw, no CDN wrapping) AND `metadata_uri`.
 *
 * Cost: 1 Helius credit per 100 tokens (so ~17 credits for ~1700 rows).
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/repopulate-images.ts
 */
import postgres from "postgres";
import {
  fetchMetadataJson,
  getAssetBatch,
  normalizeImageUrl,
  pickMetadataUri,
} from "@/lib/sources/helius";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

const BATCH = 100;

async function main() {
  // Step 1: wipe.
  const wiped = await sql`update tokens set image_url = null where image_url is not null`;
  console.log(`[repopulate] wiped ${wiped.count} image_url values`);

  // Step 2: re-resolve every row.
  const all = await sql<{ mint: string }[]>`select mint from tokens order by migrated_at desc`;
  console.log(`[repopulate] resolving ${all.length} tokens in batches of ${BATCH}`);

  let withImage = 0;
  let withUriOnly = 0;
  let nothing = 0;

  for (let i = 0; i < all.length; i += BATCH) {
    const slice = all.slice(i, i + BATCH).map((r) => r.mint);
    const assets = await getAssetBatch(slice).catch((e) => {
      console.error(`  batch ${i + 1} getAssetBatch failed:`, e);
      return [];
    });

    await Promise.all(
      slice.map(async (mint, idx) => {
        const uri = pickMetadataUri(assets[idx]);
        if (!uri) {
          nothing++;
          return;
        }
        const meta = await fetchMetadataJson(uri);
        const imageUrl = normalizeImageUrl(meta?.imageUrl ?? null);
        if (imageUrl) {
          withImage++;
          await sql`update tokens set image_url = ${imageUrl}, metadata_uri = ${uri} where mint = ${mint}`;
        } else {
          withUriOnly++;
          await sql`update tokens set metadata_uri = ${uri} where mint = ${mint}`;
        }
      }),
    );

    console.log(
      `  ${Math.min(i + BATCH, all.length)}/${all.length} — img=${withImage} uri-only=${withUriOnly} none=${nothing}`,
    );
  }

  console.log(
    `[repopulate] done — image+uri=${withImage}, uri only=${withUriOnly}, nothing=${nothing}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
