/**
 * One-shot fixup for tokens whose `image_url` is wrapped with the broken
 * Helius CDN proxy (which 403s on most ipfs.io sources). Rewrites them to
 * use the Pump.fun pinata gateway directly — same image, but a host that
 * actually serves it.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/fix-image-urls.ts
 */
import postgres from "postgres";
import { normalizeImageUrl } from "@/lib/sources/helius";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  const rows = await sql<{ mint: string; image_url: string | null }[]>`
    select mint, image_url
    from tokens
    where image_url is not null
      and (image_url like 'https://cdn.helius-rpc.com/%'
           or image_url like 'ipfs://%'
           or image_url like '%/ipfs/%')
  `;
  console.log(`[fix-image-urls] inspecting ${rows.length} candidate rows`);

  let changed = 0;
  for (const r of rows) {
    const next = normalizeImageUrl(r.image_url);
    if (!next || next === r.image_url) continue;
    await sql`update tokens set image_url = ${next} where mint = ${r.mint}`;
    changed++;
  }
  console.log(`[fix-image-urls] rewrote ${changed} rows to pump.mypinata.cloud`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
