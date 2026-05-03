/**
 * Repair pass for tokens whose `image_url` was over-rewritten to
 * pump.mypinata.cloud but whose CID isn't pinned there (filebase, etc).
 *
 * Strategy: HEAD the current `image_url`. If it 403/404s, re-fetch the
 * metadata JSON from `metadata_uri` and pull the original `image` field,
 * then run that through the (now-conservative) `normalizeImageUrl`.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/repair-image-urls.ts
 */
import postgres from "postgres";
import { fetchMetadataJson, normalizeImageUrl } from "@/lib/sources/helius";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function head(u: string): Promise<number> {
  try {
    const res = await fetch(u, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

async function main() {
  const rows = await sql<
    { mint: string; image_url: string | null; metadata_uri: string | null }[]
  >`
    select mint, image_url, metadata_uri
    from tokens
    where image_url like 'https://pump.mypinata.cloud/%'
  `;
  console.log(`[repair] checking ${rows.length} pump-pinata URLs in batches of 8`);

  let broken = 0;
  let fixed = 0;
  const BATCH = 8;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (r) => {
        if (!r.image_url) return;
        const status = await head(r.image_url);
        if (status >= 200 && status < 400) return;
        broken++;
        if (!r.metadata_uri) return;
        const meta = await fetchMetadataJson(r.metadata_uri);
        // fetchMetadataJson already normalizes; only swap if it produced
        // something different from the broken pump.mypinata URL.
        const next = normalizeImageUrl(meta?.imageUrl ?? null);
        if (!next || next === r.image_url) return;
        await sql`update tokens set image_url = ${next} where mint = ${r.mint}`;
        fixed++;
      }),
    );
    if (i % (BATCH * 10) === 0)
      console.log(`  processed ${Math.min(i + BATCH, rows.length)}/${rows.length} — broken=${broken} fixed=${fixed}`);
  }

  console.log(`[repair] done — broken=${broken}, repaired=${fixed}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
