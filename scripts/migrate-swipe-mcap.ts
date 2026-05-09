/**
 * Adds the `mcap_at_swipe_usd` column to the `swipes` table. Idempotent.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/migrate-swipe-mcap.ts
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE swipes ADD COLUMN IF NOT EXISTS mcap_at_swipe_usd numeric(20, 2)`;
  console.log("[migrate-swipe-mcap] column ensured");
  // Backfill existing likes with the token's current mcap as a best-effort
  // baseline so old likes aren't blank in the UI.
  const r = await sql`
    UPDATE swipes s
    SET mcap_at_swipe_usd = t.mcap_usd
    FROM tokens t
    WHERE s.mint = t.mint
      AND s.action = 'like'
      AND s.mcap_at_swipe_usd IS NULL
      AND t.mcap_usd IS NOT NULL
  `;
  console.log(`[migrate-swipe-mcap] backfilled ${r.count} existing likes`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
