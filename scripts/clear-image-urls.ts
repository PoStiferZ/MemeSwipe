/**
 * Drops every `image_url` value. The DB is no longer the source of truth
 * for token images — only `metadata_uri` is. Browsers fetch the JSON at
 * that URI and render the image directly.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/clear-image-urls.ts
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  const before = await sql`select count(*)::int as c from tokens where image_url is not null`;
  console.log(`[clear] ${before[0].c} rows currently have a non-null image_url`);
  const result = await sql`update tokens set image_url = null where image_url is not null`;
  console.log(`[clear] cleared ${result.count} rows`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
