/**
 * Adds the `telegram_alerted_at` column and backfills every existing row
 * with NOW() so that previously-indexed tokens aren't re-announced the
 * next time their webhook event happens to fire again.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/migrate-telegram-alerted.ts
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS telegram_alerted_at timestamptz`;
  console.log("[migrate-telegram-alerted] column ensured");
  const r = await sql`UPDATE tokens SET telegram_alerted_at = now() WHERE telegram_alerted_at IS NULL`;
  console.log(`[migrate-telegram-alerted] backfilled ${r.count} existing rows`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
